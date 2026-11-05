/**
 * Payphones — the pure rules (no Foundry globals; sim dev/tools/sims/test-payphones.mjs).
 * @file scripts/utils/payphones.js
 * @module night-city-messenger
 * @description Spec dev/design/PHONE-REVISION.md §Payphones "Decided 2026-11-03", approved mock
 *   dev/mockups/payphone-booth-mock.html. A payphone is a world record (the `payphones` setting) with a number, a scene,
 *   a LOOK (what the booth wears) and a few rules (who can hear, the help key, condition). Its map pins and step-on areas
 *   are ordinary access points (kind `payphone`). Everything here is pure so the sims, the admin preview and the booth
 *   read one set of rules.
 */

export const PP_STYLES = Object.freeze({
  street: { name: 'Street booth', sub: 'Yellow, chipped, stickers', brand: 'PetroChem PubliCom', case: '#d79f1c', panel: '#d6d8d2', hand: '#2b6c83', ink: '#6ff3ff', trim: '#1a1a1a', glass: '#070a0c',
    grit: 72, wire: 82, stickers: true, tags: [['TYGRS', '#e83a8f'], ['no future', '#1d7f2a'], ['', '#3a8fd6']], idle: 'Lift handset',
    tick: ['SLOT CHIP · 24/7 · CALLS NOT LOGGED*', '*calls may be logged', 'Need a doc? Dial a ripper.'], help: '' },
  corp: { name: 'Corporate kiosk', sub: 'Pearl, glass, quiet', brand: 'Arasaka Link', case: '#e7ebee', panel: '#f6f7f8', hand: '#1f8a92', ink: '#3fe8f5', trim: '#0f5f66', glass: '#06121a',
    grit: 4, wire: 0, stickers: false, tags: [['', '#e83a8f'], ['', '#1d7f2a'], ['', '#3a8fd6']], idle: 'Welcome. Lift to begin.',
    tick: ['Arasaka. Securing your tomorrow.', 'Calls from this kiosk may be recorded.'], help: 'TRAUMA' },
  ncpd: { name: 'NCPD call box', sub: 'Blue steel, hazard stripe', brand: 'NCPD', case: '#2a4f9a', panel: '#cfd5df', hand: '#1b1f2a', ink: '#7dff9a', trim: '#f2c200', glass: '#050a08',
    grit: 45, wire: 30, stickers: true, tags: [['PIGS', '#d63a2a'], ['', '#1d7f2a'], ['', '#3a8fd6']], idle: 'Police call point',
    tick: ['See something? Say something.', 'Misuse of this box is a crime.'], help: 'NCPD' },
  bar: { name: 'Bar wall phone', sub: 'Black, chrome, neon', brand: 'Afterlife', case: '#1b181e', panel: '#2b2830', hand: '#121014', ink: '#ff4f9a', trim: '#ff4f9a', glass: '#08050a',
    grit: 22, wire: 0, stickers: true, tags: [['', '#e83a8f'], ['', '#1d7f2a'], ['R.I.P. legends', '#2a6fd6']], idle: 'Pick up, choom',
    tick: ['Two-for-one synthweiser till 0200', 'No biz at the bar.'], help: '' },
});

export const PP_STYLE_KEYS = Object.keys(PP_STYLES);
export const PP_HEAR = Object.freeze([['caller', 'Caller\'s choice', 'The caller presses SPKR to let everyone in reach follow the call'], ['private', 'Always private', 'Nobody else hears it'], ['speaker', 'Always speaker', 'Everyone in reach follows the call (a broken handset)']]);
export const PP_HELP = Object.freeze([['NCPD', 'Dials NCPD'], ['TRAUMA', 'Dials Trauma Team'], ['', 'No help key']]);
export const PP_CONDITION = Object.freeze([['working', 'Working'], ['out', 'Out of order']]);
export const TAG_SPOTS = Object.freeze(['Big', 'Low', 'Top']);

/** Grit 0..100 → tier 0..4: 0 clean · 1 scuffed (≥20) · 2 battered, rust (≥40) · 3 rotten (≥60) · 4 wrecked (≥85). */
export const GRIT_TIERS = Object.freeze([[0, 'Clean', 'Fresh paint, nothing more.'], [20, 'Scuffed', 'Grime and scratches, paint chipped back to the steel.'], [40, 'Battered', 'Plus rust weeping from the screws.'], [60, 'Rotten', 'Plus heavier rust and grime everywhere.'], [85, 'Wrecked', 'Plus a cracked flickering screen and a dead key. Still works.']]);
export const gritTier = (g) => (g >= 85 ? 4 : g >= 60 ? 3 : g >= 40 ? 2 : g >= 20 ? 1 : 0);

/** Wiring 0..100 → tier 0..3: none · 1 handset cracked (≥10) · 2 a hole in the casing (≥40) · 3 gutted (≥75). */
export const WIRE_TIERS = Object.freeze([[0, 'None', 'No wiring shows.'], [10, 'Cracked', 'The handset cover is cracked open and its wiring shows.'], [40, 'Torn', 'Plus a hole torn in the casing with a few wires poking out.'], [75, 'Gutted', 'Plus the metal peeled back, a bundle hanging below the booth and the odd spark.']]);
export const wireTier = (w) => (w >= 75 ? 3 : w >= 40 ? 2 : w >= 10 ? 1 : 0);

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v, d) => (HEX.test(String(v || '')) ? String(v).toLowerCase() : d);
const str = (v, max, d = '') => { const s = String(v ?? d).replace(/[\r\n]+/g, ' ').trim(); return s.slice(0, max); };
const pct = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : d; };
const pick = (v, list, d) => (list.some(([k]) => k === v) ? v : d);
/** A sound path: an audio file path or http(s) url, never a script or data url. Empty = the default. */
export const safeSound = (v) => { const s = String(v || '').trim(); return /^(https?:\/\/|[\w./ -]+)\.(ogg|mp3|wav|webm|m4a|flac)$/i.test(s) && !/^(javascript|data):/i.test(s) ? s.slice(0, 300) : ''; };

/**
 * A booth's look: what it wears. Anything missing comes from its style; anything broken falls back, never throws.
 * @param {object} raw
 * @returns {object}
 */
export function sanitizeLook(raw = {}) {
  const style = PP_STYLES[raw?.style] ? raw.style : 'street';
  const base = PP_STYLES[style];
  const tags = Array.from({ length: 3 }, (_, i) => {
    const t = Array.isArray(raw?.tags) ? raw.tags[i] : null, d = base.tags[i];
    return [str(Array.isArray(t) ? t[0] : d[0], 24), hex(Array.isArray(t) ? t[1] : d[1], d[1])];
  });
  const tick = (Array.isArray(raw?.tick) ? raw.tick : base.tick).map((l) => str(l, 80)).filter(Boolean).slice(0, 6);
  return {
    style, brand: str(raw?.brand ?? base.brand, 40),
    case: hex(raw?.case, base.case), panel: hex(raw?.panel, base.panel), hand: hex(raw?.hand, base.hand), ink: hex(raw?.ink, base.ink),
    trim: hex(raw?.trim, base.trim), glass: hex(raw?.glass, base.glass),
    grit: pct(raw?.grit, base.grit), wire: pct(raw?.wire, base.wire), stickers: raw?.stickers === undefined ? base.stickers : !!raw.stickers,
    tags, idle: str(raw?.idle ?? base.idle, 40), tick,
  };
}

/** A fresh look from a style key (the booth editor's style cards). */
export const lookFromStyle = (key) => sanitizeLook({ style: PP_STYLES[key] ? key : 'street' });

/**
 * A payphone record.
 * { id, number, name (the place, e.g. "Kabuki, Night Market"), sceneId, look, condition, hear, help, range, sounds, createdAt }
 */
export function sanitizePayphone(raw = {}) {
  const look = sanitizeLook(raw?.look || {});
  const help = raw?.help === undefined ? PP_STYLES[look.style].help : raw.help;
  return {
    id: str(raw?.id, 40), number: str(raw?.number, 40), name: str(raw?.name, 60) || 'Payphone', sceneId: str(raw?.sceneId, 40),
    look, condition: pick(raw?.condition, PP_CONDITION, 'working'), hear: pick(raw?.hear, PP_HEAR, 'caller'), help: pick(help, PP_HELP, ''),
    range: Math.max(0, Math.min(20, Math.round(Number(raw?.range ?? 1)) || 0)),
    sounds: { ring: safeSound(raw?.sounds?.ring), key: safeSound(raw?.sounds?.key), hook: safeSound(raw?.sounds?.hook) },
    createdAt: Number(raw?.createdAt) || 0,
  };
}

/** The stored map → clean records, skipping anything with no id. */
export function sanitizePayphones(map = {}) {
  const out = {};
  for (const [id, raw] of Object.entries(map && typeof map === 'object' ? map : {})) {
    const p = sanitizePayphone({ ...raw, id });
    if (p.id) out[p.id] = p;
  }
  return out;
}

/** Saved booth styles: [{ id, name, look }] (a look carries no number, scene or rules). */
export function sanitizeSavedStyles(list = []) {
  return (Array.isArray(list) ? list : []).map((s) => ({ id: str(s?.id, 40), name: str(s?.name, 40), look: sanitizeLook(s?.look || {}) })).filter((s) => s.id && s.name).slice(0, 60);
}

/** What the screen says it calls itself, e.g. "Payphone, Kabuki". */
export const placeLabel = (pp) => `Payphone, ${pp?.name || 'somewhere'}`;

/**
 * May the speaker be on for this call? (the booth's rule wins over the caller's choice)
 * @param {'caller'|'private'|'speaker'} hear @param {boolean} chosen
 */
export const speakerOn = (hear, chosen) => (hear === 'speaker' ? true : hear === 'private' ? false : !!chosen);

/**
 * Is a token within reach of a pin? Centre to centre in grid squares, with the half-square grace every access point uses.
 * @param {{x:number,y:number}} token @param {{x:number,y:number}} pin @param {number} range @param {number} grid
 */
export function inReach(token, pin, range, grid = 100) {
  if (!(range > 0)) return true;
  if (!token || !pin) return false;
  return Math.hypot(token.x - pin.x, token.y - pin.y) / (grid || 100) <= range + 0.5;
}

/**
 * Who hears a booth on speaker: the users who have an owned, visible token within reach of any of its pins on its scene.
 * @param {{userId:string, x:number, y:number}[]} tokens — owned tokens on the booth's scene (one entry per user-token pair)
 * @param {{x:number,y:number}[]} pins @param {number} range @param {number} grid
 * @param {string[]} [except] — the user on the handset
 */
export function bystanders(tokens = [], pins = [], range = 1, grid = 100, except = []) {
  const out = new Set();
  const r = Math.max(range, 1);
  for (const t of tokens) if (!except.includes(t.userId) && pins.some((p) => inReach(t, p, r, grid))) out.add(t.userId);
  return [...out];
}

/** The CSS custom properties that dress a booth (the booth root carries them inline). */
export function lookVars(look) {
  const l = sanitizeLook(look);
  return `--pb-case:${l.case};--pb-panel:${l.panel};--pb-handset:${l.hand};--pb-ink:${l.ink};--pb-trim:${l.trim};--pb-glass:${l.glass};--pb-grit:${(l.grit / 100).toFixed(2)};--pb-wire:${(l.wire / 100).toFixed(2)}`;
}

/** The record for the 'payphone' phone line (phoneLines). Nobody owns it; it rings whoever stands at it. */
export const payphoneLine = (pp) => ({ number: pp.number, kind: 'payphone', type: 'pay', label: placeLabel(pp), payphoneId: pp.id,
  owner: { kind: 'payphone', actorId: null, contactId: null, name: placeLabel(pp), userIds: [], payphoneId: pp.id } });

/** A call from a booth as anyone but the GM and the person on the handset sees it: the place, never the person. */
/**
 * Who sees each side of a payphone call for real (audit PRIV-02), as send groups `{ userIds, maskFrom, maskTo }`.
 * A booth side is real only for the GMs and the person on that booth (`realUserId`; for a booth being called, also
 * whoever answered it). Everyone else gets that side masked. A non-booth side is never masked. Pure.
 * @param {object} call @param {string[]} ids @param {(id: string) => boolean} isGM
 */
export function payphoneSendGroups(call, ids, isGM) {
  const fromBooth = !!call?.from?.payphone, toBooth = call?.to?.kind === 'payphone';
  const groups = new Map();
  for (const id of ids || []) {
    const gm = isGM(id);
    const maskFrom = fromBooth && !gm && id !== call.from.realUserId;
    const maskTo = toBooth && !gm && id !== call.to?.realUserId && id !== call.answeredBy;
    const k = `${maskFrom ? 1 : 0}${maskTo ? 1 : 0}`;
    if (!groups.has(k)) groups.set(k, { userIds: [], maskFrom, maskTo });
    groups.get(k).userIds.push(id);
  }
  return [...groups.values()];
}

export function maskPayphoneSide(side = {}) {
  if (!side?.payphone && side?.kind !== 'payphone') return side;
  const { realActorId, realName, realUserId, ...rest } = side;
  return { ...rest, actorId: null, contactId: null };
}
