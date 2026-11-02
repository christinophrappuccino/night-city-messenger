/**
 * Trauma Team and Lawman Backup: the rules.
 * @file scripts/utils/phoneEmergency.js
 * @module night-city-messenger
 * @description Pure, no Foundry globals. Spec dev/design/PHONE-REVISION.md §10, §11, §17. The rules themselves are read from
 *   CORE p.223-224 and p.158-159; team stats stay in the book. The group names are our own placeholders, never the book's table: a GM renames them.
 */

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const g = (r1, r2, name) => ({ r1, r2, name, logo: '' });
const org = (name, kind, rows) => ({ name, kind, logo: '', rows: rows.map(([a, b, n]) => g(a, b, n)) });

/** Shipped organizations. A GM's changes are stored over them. */
export const DEFAULT_ORGS = Object.freeze({
  // the id stays 'book': it is the fallback for a Lawman with no organization
  book: org('No organization', 'Placeholder', [[1, 2, 'Private Guards'], [3, 4, 'Street Patrol'], [5, 7, 'Regional Deputies'], [8, 8, 'Frontier Marshal'], [9, 9, 'Tactical Squad'], [10, 10, 'Federal Agents']]),
  ncpd: org('NCPD', 'Police', [[1, 2, 'NCPD Reserve'], [1, 2, 'NCPD Traffic Unit'], [3, 4, 'NCPD Patrol Officers'], [3, 4, 'NCPD K-9 Unit'], [5, 7, 'NCPD Highway Unit'], [5, 7, 'NCPD Detectives'], [8, 8, 'NCPD Zone Command'], [9, 9, 'MAX-TAC'], [10, 10, 'NetWatch']]),
  sher: org('County Sheriff', 'Police', [[1, 2, 'Reserve Deputies'], [3, 4, 'Patrol Deputies'], [5, 7, 'County Highway Unit'], [8, 8, 'Frontier Deputies'], [9, 9, 'County Tactical'], [10, 10, 'Federal Marshals']]),
  marshal: org('Frontier Marshals', 'Government', [[3, 4, 'Town Constables'], [5, 7, 'Zone Deputies'], [8, 8, 'Senior Marshal'], [9, 9, 'Marshal Tactical'], [10, 10, 'NUSA Federal Agents']]),
  feds: org('NUSA Federal', 'Government', [[5, 7, 'Field Office'], [8, 8, 'Federal Marshal'], [9, 9, 'Tactical Response'], [10, 10, 'Federal Agents'], [10, 10, 'Interpol Liaison']]),
  nw: org('NetWatch', 'Government', [[5, 7, 'Field Technicians'], [8, 8, 'Case Officer'], [9, 9, 'Strike Team'], [10, 10, 'NetWatch Agents']]),
  mil: org('Militech Security', 'Corporate', [[1, 2, 'Site Security'], [3, 4, 'Patrol Team'], [5, 7, 'Rapid Response'], [8, 8, 'Field Marshal'], [9, 9, 'Heavy Response'], [10, 10, 'Black Ops']]),
  ara: org('Arasaka Security', 'Corporate', [[1, 2, 'Building Guards'], [3, 4, 'Corporate Patrol'], [5, 7, 'Security Team'], [9, 9, 'Counterintelligence'], [10, 10, 'Special Operations']]),
  bio: org('Biotechnica Security', 'Corporate', [[1, 2, 'Lab Guards'], [3, 4, 'Site Patrol'], [5, 7, 'Containment Team']]),
  gang: org('A private outfit', 'Private', [[1, 2, 'Hired Muscle'], [3, 4, 'Bail Enforcers'], [5, 7, 'Contract Solos']]),
});

/**
 * What a call says, slot by slot. Each slot falls back from the person to their organization to these words; Trauma Team is one
 * service, so it has one layer. `title` slots are shown in capitals. Tokens: see fillLine.
 */
export const BACKUP_SLOTS = Object.freeze([
  { key: 'channel', label: 'Channel or callsign', def: '', hint: 'On the picture frame. Blank gives them a channel number', short: true },
  { key: 'caller', label: 'They appear as', def: '{name}', hint: 'The name beside their own line', short: true },
  { key: 'speaker', label: 'Who answers', def: '{org}', hint: 'The name beside the replies', short: true },
  { key: 'ask', label: 'They call it in', def: 'I need backup at {place}.', hint: 'The caller\'s own line' },
  { key: 'standby', label: 'Waiting on the roll', def: 'Copy. Stand by.', hint: 'While the die is in the air' },
  { key: 'answer', label: 'Someone answers', def: 'Copy. Getting people moving.', hint: 'The roll passed' },
  { key: 'busy', label: 'Nobody free', def: 'Nobody free right now. Hold on.', hint: 'The roll failed' },
  { key: 'inbound', label: 'On the way', def: 'On our way to {place}.', hint: 'The rounds are known by now' },
  { key: 'openTitle', label: 'Opening title', def: 'CALLING FOR BACKUP', hint: 'Across the screen as the call opens', title: true, short: true },
  { key: 'closeTitle', label: 'Closing title', def: 'BACKUP INBOUND', hint: 'Across the screen as the call closes', title: true, short: true },
  { key: 'arriveTitle', label: 'Arrival title', def: '{org} ON SCENE', hint: 'Everyone on the scene sees this', title: true, short: true },
]);
export const TRAUMA_SLOTS = Object.freeze([
  { key: 'speaker', label: 'Who answers', def: 'Dispatch', hint: 'The name beside their lines', short: true },
  { key: 'team', label: 'What comes', def: 'AV-4', hint: 'Fills in "… inbound" on the card', short: true },
  { key: 'confirm', label: 'Picking up', def: '{line}. Confirming your plan.', hint: 'The first thing they say' },
  { key: 'locate', label: 'Finding you', def: 'We have you at {place}.', hint: 'The plan checked out' },
  { key: 'send', label: 'Sending', def: 'Sending a team now. Stay on the line.', hint: 'While the die is in the air' },
  { key: 'inbound', label: 'On the way', def: 'Team\'s in the air. {rounds} out. Stay where you are.', hint: 'The rounds are known by now' },
  { key: 'closeTitle', label: 'Closing title', def: 'TEAM EN ROUTE', hint: 'Across the screen as the call closes', title: true, short: true },
  { key: 'arriveTitle', label: 'Arrival title', def: '{line} ON SCENE', hint: 'Everyone on the scene sees this', title: true, short: true },
]);
/** The fill-ins a line may use. */
export const LINE_TOKENS = Object.freeze({ backup: ['place', 'name', 'org', 'group', 'rounds'], trauma: ['place', 'name', 'line', 'plan', 'rounds'] });
const LINE_MAX = 200, LINES_PER_SLOT = 8;

/** { slot: [lines] }, only slots with words in them. A blank slot inherits. */
function sanitizeVoice(v, slots) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const { key } of slots) {
    const lines = (Array.isArray(v[key]) ? v[key] : typeof v[key] === 'string' ? v[key].split('\n') : []).map((l) => String(l ?? '').trim().slice(0, LINE_MAX)).filter(Boolean).slice(0, LINES_PER_SLOT);
    if (lines.length) out[key] = lines;
  }
  return out;
}
const HEX = /^#[0-9a-f]{6}$/i;
const sanitizeLook = (l) => {
  const o = l && typeof l === 'object' ? l : {}, out = {};
  if (HEX.test(o.color || '')) out.color = o.color;
  if (o.lights === true || o.lights === false) out.lights = o.lights;
  for (const k of ['openSound', 'arriveSound']) if (o[k] && typeof o[k] === 'string') out[k] = o[k];
  return out;
};
const sanitizeGroup = (r) => { const r1 = Math.min(10, Math.max(1, Number(r?.r1) || 1)); return { r1, r2: Math.min(10, Math.max(r1, Number(r?.r2) || r1)), name: String(r?.name ?? 'Group').slice(0, 50), logo: String(r?.logo ?? '') }; };
function sanitizePerson(p) {
  const o = p && typeof p === 'object' ? p : {};
  return { voice: sanitizeVoice(o.voice, BACKUP_SLOTS), look: sanitizeLook(o.look), img: String(o.img ?? ''), groups: (Array.isArray(o.groups) ? o.groups : []).map(sanitizeGroup) };
}

const itemList = (v) => (Array.isArray(v) ? v : []).map((x) => (typeof x === 'string' ? { name: x } : { name: String(x?.name ?? ''), type: x?.type || '', img: x?.img || '' })).filter((x) => x.name);

/** Every setting filled in. Never throws. */
export function sanitizeEmergency(stored = {}) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const t = s.trauma && typeof s.trauma === 'object' ? s.trauma : {};
  const b = s.backup && typeof s.backup === 'object' ? s.backup : {};
  const orgs = {};
  for (const [id, o] of Object.entries(b.orgs && typeof b.orgs === 'object' ? b.orgs : DEFAULT_ORGS)) {
    if (!o) continue;
    orgs[id] = { name: String(o.name ?? 'Organization').slice(0, 50), kind: String(o.kind ?? 'Private'), logo: String(o.logo ?? ''), voice: sanitizeVoice(o.voice, BACKUP_SLOTS), look: sanitizeLook(o.look),
      rows: (Array.isArray(o.rows) ? o.rows : []).map(sanitizeGroup) };
  }
  const people = {};
  for (const [id, p] of Object.entries(b.people && typeof b.people === 'object' ? b.people : {})) people[id] = sanitizePerson(p);
  return {
    trauma: { source: t.source === 'item' ? 'item' : 'hand', itemSilver: itemList(t.itemSilver), itemExec: itemList(t.itemExec), teamwork: t.teamwork !== false, auto: t.auto !== false,
      bioItem: t.bioItem === undefined ? [{ name: 'Biomonitor', type: 'cyberware', img: '' }] : itemList(t.bioItem), noPlan: t.noPlan === 'ring' ? 'ring' : 'refuse', specialId: String(t.specialId ?? 'TRAUMA'),
      plans: t.plans && typeof t.plans === 'object' ? t.plans : {}, voice: sanitizeVoice(t.voice, TRAUMA_SLOTS) },
    backup: { orgs, chars: b.chars && typeof b.chars === 'object' ? b.chars : {}, people },
  };
}

/**
 * Does a character hold any item on a list? Cyberware counts only once installed.
 * @param {{name: string, type: string, img?: string, system?: object}[]} items
 * @param {{name: string, type?: string}[]} list
 * @returns {{item: object, how: 'Carried'|'Installed'|'Not installed', counts: boolean}|null}
 */
export function holdsItem(items, list) {
  let spare = null;
  for (const want of list || []) {
    const n = norm(want.name);
    for (const i of items || []) {
      if (norm(i.name) !== n || (want.type && i.type !== want.type)) continue;
      if (i.type !== 'cyberware') return { item: i, how: 'Carried', counts: true };
      if (i.system?.isInstalledInActor) return { item: i, how: 'Installed', counts: true };
      spare ??= { item: i, how: 'Not installed', counts: false };
    }
  }
  return spare;
}

/** A role's rank, from the character's role items. 0 when they don't have it. */
export function roleRank(items, roleName) {
  const r = (items || []).find((i) => i.type === 'role' && norm(i.name) === norm(roleName));
  return r ? Number(r.system?.rank) || 0 : 0;
}

/** The plan a character is on: 'none' | 'silver' | 'exec'. */
export function traumaPlan(cfg, { actorId, items = [] }) {
  const t = cfg.trauma;
  let plan = 'none';
  if (t.source === 'item') { if (holdsItem(items, t.itemExec)?.counts) plan = 'exec'; else if (holdsItem(items, t.itemSilver)?.counts) plan = 'silver'; }
  else if (['silver', 'exec'].includes(t.plans[actorId])) plan = t.plans[actorId];
  if (plan !== 'exec' && t.teamwork) { const rank = roleRank(items, 'Exec'); if (rank >= 8) plan = 'exec'; else if (rank >= 6 && plan === 'none') plan = 'silver'; }
  return plan;
}

export const PLAN_NAMES = Object.freeze({ none: 'No plan', silver: 'Silver', exec: 'Executive' });

/** Book rule: a linked Biomonitor calls by itself when HP drops below BODY. */
export function autoCallDue(cfg, { hp, body, wasHp, items = [] }) {
  if (!cfg.trauma.auto || !(hp < body) || !(hp < (wasHp ?? Infinity))) return false;
  return !!holdsItem(items, cfg.trauma.bioItem)?.counts;
}

/**
 * The special number Trauma Team calls go through, with its name, number and picture. The GM can rename it or pick another; with
 * none left, the shipped words stand in.
 * @param {{id: string, num: string, name: string, img: string}[]} specials @param {string} specialId
 * @param {(num: string) => string} keyOf - how a number is matched when dialled
 */
export function traumaLine(specials, specialId, keyOf) {
  const list = specials || [];
  const x = list.find((s) => s.id === specialId) || list.find((s) => keyOf(s.num) === 'TRAUMA') || null;
  return { id: x?.id || '', key: x ? keyOf(x.num) : 'TRAUMA', name: x?.name || 'Trauma Team', number: x?.num || 'TRAUMA', img: x?.img || '' };
}

/** A Backup call's picture: the group's own, else the person's, else their organization's, else none. */
export const backupArt = (o, group, person = null) => group?.logo || person?.img || o?.logo || '';

/** A Lawman's organization with their own groups added. Theirs come first, so at the same rank they reach for their own people. */
export function orgForPerson(cfg, orgId, actorId) {
  const o = cfg.backup.orgs[orgId], p = cfg.backup.people?.[actorId];
  if (!o) return o;
  return p?.groups?.length ? { ...o, rows: [...p.groups.map((r) => ({ ...r, own: true })), ...o.rows] } : o;
}

/**
 * Which words each slot uses, and where they come from. The first layer with words wins, then the built-in line.
 * @param {{key: string, def: string}[]} slots @param {{label: string, voice: object}[]} layers - nearest first
 */
export function voiceSources(slots, layers) {
  const out = {};
  for (const s of slots) {
    const at = layers.find((l) => l?.voice?.[s.key]?.length);
    out[s.key] = at ? { lines: at.voice[s.key], from: at.label } : { lines: s.def ? [s.def] : [], from: 'Built in' };
  }
  return out;
}
/** One line per slot, picked once for the whole call, because a call redraws many times. */
export function pickVoice(slots, layers, rand = Math.random) {
  const src = voiceSources(slots, layers), out = {};
  for (const s of slots) { const l = src[s.key].lines; out[s.key] = l.length ? l[Math.min(l.length - 1, Math.floor(rand() * l.length))] : ''; }
  return out;
}
export const backupLayers = (cfg, orgId, actorId) => { const o = cfg.backup.orgs[orgId]; return [{ label: 'This person', voice: cfg.backup.people?.[actorId]?.voice }, { label: o?.name || 'Organization', voice: o?.voice }]; };
export const traumaLayers = (cfg) => [{ label: 'Your words', voice: cfg.trauma.voice }];

/** What holds the words and look for a scope: 't' Trauma Team, 'o:<id>' an organization, 'p:<actorId>' a person (made on first use). */
export function voiceHolder(cfg, scope) {
  const s = String(scope ?? '');
  if (s === 't') return cfg.trauma;
  if (s.startsWith('o:')) return cfg.backup.orgs[s.slice(2)] || null;
  if (s.startsWith('p:')) { const id = s.slice(2); return id ? (cfg.backup.people[id] ??= sanitizePerson({})) : null; }
  return null;
}
/** How many things are set on a person. */
export const personChanges = (p) => Object.keys(p?.voice || {}).length + (p?.groups?.length || 0) + Object.keys(p?.look || {}).length + (p?.img ? 1 : 0);
/** Fill-ins in these lines that this kind of call does not know. */
export function badTokens(lines, kind) {
  const known = LINE_TOKENS[kind] || [];
  return [...new Set((lines || []).join(' ').match(/\{\w+\}/g) || [])].filter((t) => !known.includes(t.slice(1, -1)));
}
/** The sounds an emergency call can use. */
export const EMERGENCY_SOUNDS = Object.freeze(['em-sting-backup', 'em-radio-in', 'em-radio-out', 'em-dispatch', 'em-arrive-backup', 'em-arrive-trauma', 'em-sting-trauma']);

/** Put the fill-ins in. `{rounds}` reads "3 rounds". A token we don't know stays as typed, so a typo shows in play and in the preview. */
export function fillLine(text, tokens = {}) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => {
    if (k === 'rounds' && Number.isFinite(tokens.rounds)) return `${tokens.rounds} round${tokens.rounds === 1 ? '' : 's'}`;
    return tokens[k] === undefined || tokens[k] === null ? m : String(tokens[k]);
  });
}

/** The groups a Lawman of this rank may call, lowest first. */
export const backupOptions = (o, rank) => (o?.rows || []).filter((r) => r.r1 <= rank).sort((a, b) => a.r1 - b.r1);
/** The group they reach for by default: the strongest they can call. */
export function backupDefault(o, rank) {
  const list = backupOptions(o, rank);
  if (!list.length) return null;
  const top = Math.max(...list.map((r) => r.r1));
  return list.find((r) => r.r1 === top);
}

/**
 * Book rule: d10 at or under rank and someone answers. Then a d6 for the rounds; a 6 brings the next group up, and a second d6 sets the rounds.
 * @returns {{ok: boolean, up?: boolean, who?: string, needsSecond?: boolean, rounds?: number}}
 */
export function backupResult(o, from, { d10, rank, d6 = null, second = null }) {
  if (!(d10 <= rank)) return { ok: false };
  const up = d6 === 6;
  const next = up ? [...o.rows].sort((a, b) => a.r1 - b.r1).find((r) => r.r1 > from.r2) : null;
  return { ok: true, up: up && !!next, who: up ? (next ? next.name : `${from.name} (two groups)`) : from.name, needsSecond: up, rounds: up ? second : d6 };
}

/** The heart trace: faster and shakier as HP drops. */
export const vitals = (hp, max) => { const low = max > 0 ? hp / max : 1; return { bpm: low < 0.2 ? 148 : low < 0.5 ? 118 : 76, wob: low < 0.2 ? 1 : 0.35 }; };

/**
 * The pace of a call, in milliseconds from the start, one time per step. These are people on a line, so it takes its time:
 * a few rings, someone picks up, they check, they find you. `organicBeats` loosens each gap so no two calls run alike.
 */
export const TRAUMA_BEATS = Object.freeze([0, 4400, 8400, 12800, 16000]);
export const BACKUP_BEATS = Object.freeze([0, 3200, 6800, 10000, 14000]);
export const TRAUMA_STEPS = Object.freeze(['Plan', 'Location', 'Dispatch', 'En route']);
export const BACKUP_STEPS = Object.freeze(['Call', 'Roll', 'Answer', 'En route']);
/** How long the result stays up before the call closes. */
export const TRAUMA_HOLD = 11000, BACKUP_HOLD = 10000;

/**
 * Each gap between steps, loosened by up to `spread` either way. Always rising, and the first step stays at 0.
 * @param {number[]} beats @param {() => number} [rand] @param {number} [spread]
 */
export function organicBeats(beats, rand = Math.random, spread = 0.2) {
  const out = [0];
  for (let i = 1; i < beats.length; i++) out.push(Math.round(out[i - 1] + (beats[i] - beats[i - 1]) * (1 + (rand() * 2 - 1) * spread)));
  return out;
}

/** Outside combat a team's rounds count down by themselves, this long each. */
export const ROUND_MS = 6000;
/** Is a round due on the clock? Combat counts its own, a held team waits, and a paused game stops time. */
export const roundDue = (e, { now, lastAt, combatOn = false, paused = false }) => !e.arrived && !e.held && !combatOn && !paused && now - lastAt >= ROUND_MS;
/** What the strip on a player's screen means. */
export function miniWhy(e, { combatOn = false } = {}) {
  if (e.held) return 'On the way, but your GM is holding them for now.';
  return combatOn ? 'On the way. One round passes with each round of combat.' : 'On the way. They arrive when the rounds run out, about 6 seconds each. Your GM can change that.';
}

/** What an organization can be. Backup is whoever a Lawman can call: the law, a corp's security, a gang, a nomad pack. */
export const ORG_KINDS = Object.freeze(['Police', 'Government', 'Corporate', 'Private', 'Other']);

/**
 * How a Backup call looks and sounds. By default only the law gets red and blue lights and a siren; an organization, then a person, can change that.
 * @param {string} kind - the organization's kind
 * @param {object} [orgLook] @param {object} [personLook]
 * @returns {{color: string, lights: boolean, icon: string, openSound: string, arriveSound: string}}
 */
export function backupLook(kind, orgLook = null, personLook = null) {
  const pick = (k) => personLook?.[k] ?? orgLook?.[k];
  const lights = pick('lights') ?? (kind === 'Police' || kind === 'Government');
  const base = lights ? { color: '#6db3ff', icon: 'fa-shield-halved', arriveSound: 'em-arrive-backup' } : { color: '#ffb454', icon: 'fa-people-group', arriveSound: 'em-radio-out' };
  return { ...base, lights, color: pick('color') || base.color, openSound: pick('openSound') || 'em-sting-backup', arriveSound: pick('arriveSound') || base.arriveSound };
}
