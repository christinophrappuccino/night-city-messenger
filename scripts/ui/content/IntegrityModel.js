/**
 * IntegrityModel — the rules of shard integrity, as pure functions.
 * @file scripts/ui/content/IntegrityModel.js
 * @module night-city-messenger
 *
 * No Foundry globals, so `dev/tools/sims/test-integrity.mjs` drives the real thing.
 * Design: dev/design/SHARD-INTEGRITY.md.
 *
 * Two layers:
 *   - the SHARD's integrity (one number, the bar) — drives the visual glitching
 *     and whether the chip is dead at 0;
 *   - each ENTRY's `corruption` (0..1 in quarter steps, mechanical mode only) —
 *     drives which parts of that entry are actually gone.
 *
 * Which parts are gone is DERIVED, never stored: every unit (a cell, a frame, a
 * chat message…) has a fixed seeded threshold, and is lost when its threshold is
 * below the entry's level. So damage only ever grows over the same set, a
 * reconstruct gives back the most recently lost first, and nothing crawls
 * between renders.
 */

// ─── Config ───

/** Every key the integrity block can carry, with its default. */
export const INTEGRITY_DEFAULTS = Object.freeze({
  enabled: false,
  mode: 'cosmetic',                 // 'cosmetic' (visual only) | 'mechanical' (data loss)
  maxIntegrity: 100,
  currentIntegrity: 100,
  degradePerFailure: 15,
  corruptionThreshold: 50,          // PERCENT — loss starts below this
  corruptionChance: 0.4,            // per entry, per failed breach
  hardening: 0,                     // % less lost per breach (Encoder tiers stamp this)
  legibility: 'rough',              // 'readable' | 'rough' | 'hard'
  effects: { scan: true, tear: true, garble: true, steady: true },
  loss: 'parts',                    // 'parts' | 'whole'
  hideLost: false,
  protectMoney: true,
  programsGlitchy: true,
  glitchDV: 2,
  misfire: 25,                      // %
  recon: { enabled: true, skill: 'Electronics/Security Tech', dv: 13, perStep: 2, step: '25', worsen: true },
  repairPts: 15,
  dead: { list: 'list', salvage: true, salvageDV: 22, salvagePct: 20 },
  history: [],                      // integrity after each hit — the dead screen's trace
  lastHit: null,                    // { by, at }
  salvaged: [],                     // actor ids that have spent their salvage attempt
});

const LEGIBILITY = ['readable', 'rough', 'hard'];
const DEAD_LIST = ['list', 'count', 'none'];
const RECON_STEPS = ['25', '50', 'all'];

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const bool = (v, d) => (v === undefined || v === null ? d : !!v);

/**
 * Stored block → the full, safe config. Absent keys take their defaults, so a
 * shard saved before this rework reads correctly with no migration. Zero is a
 * legal value everywhere it means something (threshold 0 = never lose data,
 * chance 0 = never, hardening 0 = none).
 */
export function resolveIntegrity(stored = {}) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const D = INTEGRITY_DEFAULTS;
  const max = clamp(Math.round(num(s.maxIntegrity, D.maxIntegrity)), 1, 1000);
  // Legacy: chance stored as 0..1; a value above 1 is a percent typed by hand.
  let chance = num(s.corruptionChance, D.corruptionChance);
  if (chance > 1) chance /= 100;
  const recon = { ...D.recon, ...(s.recon || {}) };
  const dead = { ...D.dead, ...(s.dead || {}) };
  const fx = { ...D.effects, ...(s.effects || {}) };
  return {
    enabled: !!s.enabled,
    mode: s.mode === 'mechanical' ? 'mechanical' : 'cosmetic',
    maxIntegrity: max,
    currentIntegrity: clamp(Math.round(num(s.currentIntegrity, max)), 0, max),
    degradePerFailure: clamp(Math.round(num(s.degradePerFailure, D.degradePerFailure)), 0, 1000),
    corruptionThreshold: clamp(Math.round(num(s.corruptionThreshold, D.corruptionThreshold)), 0, 100),
    corruptionChance: clamp(chance, 0, 1),
    hardening: clamp(Math.round(num(s.hardening, 0)), 0, 90),
    legibility: LEGIBILITY.includes(s.legibility) ? s.legibility : D.legibility,
    effects: { scan: !!fx.scan, tear: !!fx.tear, garble: !!fx.garble, steady: !!fx.steady },
    loss: s.loss === 'whole' ? 'whole' : 'parts',
    hideLost: !!s.hideLost,
    protectMoney: bool(s.protectMoney, D.protectMoney),
    programsGlitchy: bool(s.programsGlitchy, D.programsGlitchy),
    glitchDV: clamp(Math.round(num(s.glitchDV, D.glitchDV)), 0, 20),
    misfire: clamp(Math.round(num(s.misfire, D.misfire)), 0, 100),
    recon: {
      enabled: !!recon.enabled,
      skill: String(recon.skill || D.recon.skill),
      dv: clamp(Math.round(num(recon.dv, D.recon.dv)), 1, 40),
      perStep: clamp(Math.round(num(recon.perStep, D.recon.perStep)), 0, 10),
      step: RECON_STEPS.includes(String(recon.step)) ? String(recon.step) : D.recon.step,
      worsen: !!recon.worsen,
    },
    repairPts: clamp(Math.round(num(s.repairPts, D.repairPts)), 1, 1000),
    dead: {
      list: DEAD_LIST.includes(dead.list) ? dead.list : D.dead.list,
      salvage: !!dead.salvage,
      salvageDV: clamp(Math.round(num(dead.salvageDV, D.dead.salvageDV)), 1, 40),
      salvagePct: clamp(Math.round(num(dead.salvagePct, D.dead.salvagePct)), 1, 100),
    },
    history: Array.isArray(s.history) ? s.history.map((v) => clamp(Math.round(num(v)), 0, 100)).slice(-40) : [],
    lastHit: s.lastHit && typeof s.lastHit === 'object' ? { by: String(s.lastHit.by || ''), at: String(s.lastHit.at || '') } : null,
    salvaged: Array.isArray(s.salvaged) ? s.salvaged.map(String) : [],
  };
}

// ─── Tiers ───

/** Integrity percent of a resolved config. */
export const percentOf = (cfg) => (cfg.maxIntegrity > 0 ? Math.round((cfg.currentIntegrity / cfg.maxIntegrity) * 100) : 0);

/** clean ≥75 · light 50–74 · heavy 25–49 · severe 1–24 · bricked 0. */
export function tierOf(pct) {
  if (pct <= 0) return 'bricked';
  if (pct <= 24) return 'severe';
  if (pct <= 49) return 'heavy';
  if (pct <= 74) return 'light';
  return 'clean';
}
export const TIER_ORDER = ['clean', 'light', 'heavy', 'severe', 'bricked'];
export const TIER_WORD = Object.freeze({ light: 'Degraded', heavy: 'Unstable', severe: 'Critical', bricked: 'Bricked' });

/** Share of characters the cosmetic garble paints over, by legibility × tier. */
export const GARBLE_RATES = Object.freeze({
  readable: { light: 0.02, heavy: 0.05, severe: 0.09 },
  rough:    { light: 0.04, heavy: 0.12, severe: 0.22 },
  hard:     { light: 0.07, heavy: 0.24, severe: 0.45 },
});
export function garbleRate(legibility, tier) {
  return GARBLE_RATES[legibility]?.[tier] ?? 0;
}

// ─── Seeded randomness ───

/** Deterministic PRNG from a string seed (FNV-1a → xorshift). Returns () => [0,1). */
export function rng(seed) {
  let h = 2166136261 >>> 0;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  if (!h) h = 0x9e3779b9;
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return (h % 1e6) / 1e6; };
}

export const GLYPHS = '▓▒░█#@%&$§¤¦╳Ξ01/\\<>';
/** The marker written into data that is really gone. The viewer styles any text carrying it. */
export const LOST = '▒▒▒';

/** Is unit `key` of entry `id` lost at `level`? Fixed threshold per unit → monotonic. */
export function isUnitLost(id, key, level) {
  return level > 0 && rng(`${id}:${key}`)() < level;
}

/** Data-level garble for plain text (mechanical = the characters are really gone). */
export function garbleString(s, rate, seed) {
  if (!s || rate <= 0) return s;
  const r = rng(seed);
  // Skip whitespace and anything inside an HTML tag, so markup survives.
  let inTag = false;
  return Array.from(String(s)).map((ch) => {
    if (ch === '<') inTag = true;
    if (inTag) { if (ch === '>') inTag = false; return ch; }
    if (!ch.trim()) return ch;
    return r() < rate ? GLYPHS[Math.floor(r() * GLYPHS.length)] : ch;
  }).join('');
}

/** Quarter-step clamp. */
export const quantize = (v) => clamp(Math.round(num(v) * 4) / 4, 0, 1);

/** An entry's stored damage level — legacy `corrupted: true` reads as fully lost. */
export function entryLevel(entry) {
  if (typeof entry?.corruption === 'number') return quantize(entry.corruption);
  return entry?.corrupted ? 1 : 0;
}

// ─── Per-type loss ───

const isMoney = (t) => t === 'eddies' || t === 'banking';
const isProgram = (t) => t === 'payload' || t === 'malware';

/**
 * Apply MECHANICAL loss to a copy of an entry. Runs before enrichContent, so lost
 * data never reaches a player's DOM.
 *
 * @param {object} entry   a shard entry (mutated — pass a clone)
 * @param {number} level   0..1
 * @param {object} cfg     a resolved integrity config
 * @returns {{ lost:number, total:number, unit:string, special:string|null, gone:boolean }}
 */
export function applyLoss(entry, level, cfg) {
  const id = entry.id || entry.messageId || 'entry';
  const t = entry.contentType || 'message';
  const out = { lost: 0, total: 0, unit: '', special: null, gone: false };
  if (!(level > 0)) return out;

  // Exceptions first — they never lose the thing that matters.
  if (isMoney(t) && cfg.protectMoney && t === 'eddies') return { ...out, special: 'safe' };
  if (isProgram(t) && cfg.programsGlitchy) return { ...out, special: 'glitchy' };

  if (cfg.loss === 'whole') {
    if (isMoney(t) && cfg.protectMoney) return { ...out, special: 'safe' };
    return { ...out, gone: level >= 0.5 };
  }
  if (level >= 1 && !(isMoney(t) && cfg.protectMoney)) return { ...out, gone: true };

  const cd = entry.contentData || (entry.contentData = {});
  const each = (arr, fn, prefix = '') => {
    let lost = 0;
    (arr || []).forEach((x, k) => { if (isUnitLost(id, `${prefix}${k}`, level)) { lost++; fn(x, k); } });
    return lost;
  };
  const words = (s) => Math.max(1, Math.ceil(String(s || '').replace(/<[^>]+>/g, '').trim().split(/\s+/).length));

  switch (t) {
    case 'spreadsheet': {
      let lost = 0, total = 0;
      (cd.rows || []).forEach((row, r) => (row || []).forEach((cell, c) => {
        total++;
        if (isUnitLost(id, `${r}.${c}`, level)) { lost++; row[c] = '#ERR!'; }
      }));
      if (cd.note && isUnitLost(id, 'note', level)) cd.note = `${LOST} note lost ${LOST}`;
      return { ...out, lost, total, unit: 'cells' };
    }
    case 'chatlog': {
      const msgs = (cd.messages || []).filter((m) => m.kind !== 'system');
      const lost = each(msgs, (m) => {
        for (const k of ['from', 'text', 'image', 'caption', 'reactions', 'seen', 'seenTime', 'deleted']) delete m[k];
        Object.assign(m, { kind: 'system', system: `${LOST} packet lost ${LOST}`, sysIcon: 'triangle-exclamation' });
      });
      return { ...out, lost, total: msgs.length, unit: 'messages' };
    }
    case 'gallery':
      return { ...out, lost: each(cd.images, (im) => { im.corrupted = true; delete im.caption; }), total: (cd.images || []).length, unit: 'frames' };
    case 'syslog':
      return { ...out, lost: each(cd.lines, (l) => { l.msg = `${LOST} CRC fail — sector unreadable ${LOST}`; l.actor = '???'; l.mark = false; }), total: (cd.lines || []).length, unit: 'lines' };
    case 'document': {
      const lost = each(cd.paragraphs, (p) => {
        if (p.kind === 'list') p.items = (p.items || []).map(() => `${LOST} sector lost ${LOST}`);
        else if (p.kind === 'figure') { p.image = ''; p.caption = `${LOST} figure lost ${LOST}`; }
        else { p.text = `${LOST} sector lost — ${words(p.text)} words unrecoverable ${LOST}`; p.redacted = false; }
      });
      return { ...out, lost, total: (cd.paragraphs || []).length, unit: 'paragraphs' };
    }
    case 'record': {
      let lost = 0, total = 0;
      (cd.records || []).forEach((rec, r) => {
        (rec.fields || []).forEach((f, k) => {
          total++;
          if (isUnitLost(id, `${r}.${k}`, level)) {
            lost++;
            f.label = f.label || f.kind || 'field';
            f.kind = 'custom'; f.value = LOST;
          }
        });
        // Legacy flat records carry their data top-level.
        for (const k of ['role', 'org', 'address', 'note']) {
          if (rec[k]) { total++; if (isUnitLost(id, `${r}.${k}`, level)) { lost++; rec[k] = LOST; } }
        }
      });
      return { ...out, lost, total, unit: 'fields' };
    }
    case 'calendar':
      return { ...out, lost: each(cd.events, (ev) => { ev.title = `${LOST} event data lost ${LOST}`; delete ev.location; delete ev.who; delete ev.note; delete ev.category; delete ev.sceneId; }), total: (cd.events || []).length, unit: 'events' };
    case 'credentials':
      return { ...out, lost: each(cd.entries, (c) => { c.user = LOST; c.secret = '▒▒▒▒▒▒▒▒'; c.strength = 0; delete c.note; c.encrypted = false; }), total: (cd.entries || []).length, unit: 'credentials' };
    case 'dossier': {
      const lost = each(cd.sections, (s) => { s.body = `${LOST} section unrecoverable ${LOST}`; s.redacted = false; });
      const stats = cd.stats && typeof cd.stats === 'object' ? Object.keys(cd.stats) : [];
      let sl = 0; stats.forEach((k) => { if (isUnitLost(id, `stat.${k}`, level)) { sl++; cd.stats[k] = LOST; } });
      return { ...out, lost: lost + sl, total: (cd.sections || []).length + stats.length, unit: 'sections' };
    }
    case 'avlog': {
      const lost = each(cd.transcript, (l) => { l.text = `${LOST} inaudible — data loss ${LOST}`; });
      return { ...out, lost, total: (cd.transcript || []).length, unit: 'lines' };
    }
    case 'schematic':
      return { ...out, lost: each(cd.annotations, (a) => { a.label = LOST; a.note = ''; a.type = 'pin'; delete a.sceneId; }), total: (cd.annotations || []).length, unit: 'markers' };
    case 'banking': {
      const lost = each(cd.transactions, (tx) => { tx.desc = `${LOST} memo lost ${LOST}`; if (!cfg.protectMoney) tx.amount = 0; });
      if (!cfg.protectMoney && level >= 0.75) cd.allowSiphon = false;
      return { ...out, lost, total: (cd.transactions || []).length, unit: 'ledger lines', special: cfg.protectMoney ? 'safe' : null };
    }
    case 'eddies': {
      // Only reached with protectMoney OFF: the drop really loses eb.
      cd.amount = Math.round(num(cd.amount) * (1 - level));
      return { ...out, lost: Math.round(level * 100), total: 100, unit: '% of the eb', special: 'eb' };
    }
    case 'payload': case 'malware':
      // Only reached with programsGlitchy OFF: below full loss the program runs as written.
      return { ...out, lost: 0, total: 0, unit: '' };
    default: {
      // message / note / location — the text itself degrades.
      const rate = level * 0.55;
      if (t === 'note') cd.text = garbleString(cd.text, rate, `${id}:t`);
      else if (t === 'location') {
        for (const k of ['description', 'coordinates', 'access', 'approach', 'contact', 'hours']) if (cd[k]) cd[k] = garbleString(cd[k], rate, `${id}:${k}`);
      } else entry.body = garbleString(entry.body, rate, `${id}:b`);
      return { ...out, lost: Math.round(rate * 100), total: 100, unit: '% of the text', special: 'text' };
    }
  }
}

/** One-line description of the damage for the bar under the entry header. */
export function damageSummary(dmg) {
  if (!dmg) return '';
  if (dmg.special === 'text' || dmg.special === 'eb') return `~${dmg.lost}${dmg.unit} unreadable`;
  if (dmg.special === 'safe') return dmg.lost ? `${dmg.lost} of ${dmg.total} memos lost — balances untouched` : 'The transfer data survived the damage';
  if (!dmg.total) return 'Damaged';
  return dmg.lost ? `${dmg.lost} of ${dmg.total} ${dmg.unit} unreadable` : `Damaged, but no ${dmg.unit} lost yet`;
}

// ─── Hits, recovery ───

/**
 * How much one hit takes, after hardening. A hardened chip still loses at least
 * one point per hit — hardening slows damage, it never stops it.
 */
export function effectiveHit(amount, hardening = 0) {
  const a = Math.max(0, Math.round(num(amount)));
  if (!a) return 0;
  return Math.max(1, Math.round(a * (1 - clamp(num(hardening), 0, 90) / 100)));
}

/** Reconstruct DV — harder the more of the entry is gone. */
export function reconDV(level, cfg) {
  return cfg.recon.dv + Math.round(quantize(level) * 4) * cfg.recon.perStep;
}

/** The level after a reconstruct attempt. */
export function afterRecon(level, ok, cfg) {
  const l = quantize(level);
  if (ok) return cfg.recon.step === 'all' ? 0 : quantize(l - Number(cfg.recon.step) / 100);
  return cfg.recon.worsen ? quantize(l + 0.25) : l;
}

/** Penalty a damaged program runs with, or null when it runs clean. */
export function unstableFor(level, cfg) {
  if (!(level > 0) || !cfg.programsGlitchy) return null;
  return { dvPenalty: cfg.glitchDV, misfire: cfg.misfire };
}

/**
 * The integrity trace on the dead screen: one step down per hit, then flat.
 * Returns an SVG path for a W×H box (top = 100%).
 */
export function traceGeometry(history, W = 600, H = 54) {
  const h = (history?.length ? history : [100, 0]).map((v) => clamp(num(v), 0, 100));
  const pts = h[0] === 100 ? h : [100, ...h];
  const n = Math.max(1, pts.length - 1);
  const stepW = (W * 0.72) / n;
  const y = (v) => (H - 4 - (v / 100) * (H - 8)).toFixed(1);
  let d = `M0 ${y(pts[0])}`;
  pts.slice(1).forEach((v, k) => { d += ` H${((k + 1) * stepW).toFixed(1)} V${y(v)}`; });
  return { d, flatX: +(n * stepW).toFixed(1), baseY: H - 4, W, H, labels: pts };
}
