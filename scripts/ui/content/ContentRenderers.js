/**
 * ContentRenderers — shared content-type registry
 * @file scripts/ui/content/ContentRenderers.js
 * @module cyberpunkred-messenger
 * @description Single source of truth for rendering a typed content entry
 *              ({ contentType, contentData, ... }) — consumed by BOTH the Data
 *              Shard viewer (ItemInboxApp) and the Terminal viewer
 *              (TerminalViewerApp) so a downloaded spreadsheet/calendar/log
 *              looks identical wherever it is opened (design doc §8c, §9b).
 *
 *              Two halves that MUST stay in lock-step:
 *                1. CONTENT_TYPE_INFO — label / icon / accent / indexIcon per type.
 *                2. enrichContent()   — turns a raw entry into the view-model the
 *                   shared `templates/content/content-body.hbs` partial renders
 *                   (is<Type> flags + per-type processed contentData).
 *
 *              Adding a new content type = one CONTENT_TYPES entry + one
 *              CONTENT_TYPE_INFO row + (optionally) one ENRICHERS function + one
 *              `{{else if isX}}` branch in content-body.hbs. Nothing else.
 */

import { CONTENT_TYPES } from '../../utils/constants.js';
import { log, formatCyberDate, resolveMediaEmbed } from '../../utils/helpers.js';

/**
 * Display info per content type. `accent` is a palette key consumed by CSS
 * (`ncm-ci-<accent>` / `ncm-shard-index-chip--<accent>`); `indexIcon` is the
 * compact glyph used in the shard index strip.
 * @type {Object<string, {label:string, icon:string, accent:string, indexIcon:string}>}
 */
export const CONTENT_TYPE_INFO = {
  [CONTENT_TYPES.MESSAGE]:  { label: 'Message',          icon: 'fas fa-envelope',       accent: 'cyan',   indexIcon: 'fas fa-envelope' },
  [CONTENT_TYPES.EDDIES]:   { label: 'Eddies Dead Drop', icon: 'fas fa-sack-dollar',    accent: 'gold',   indexIcon: 'fas fa-sack-dollar' },
  [CONTENT_TYPES.DOSSIER]:  { label: 'Dossier',          icon: 'fas fa-id-badge',       accent: 'red',    indexIcon: 'fas fa-id-badge' },
  [CONTENT_TYPES.PAYLOAD]:  { label: 'Payload',          icon: 'fas fa-virus',          accent: 'purple', indexIcon: 'fas fa-virus' },
  [CONTENT_TYPES.AVLOG]:    { label: 'Audio/Video Log',  icon: 'fas fa-headphones',     accent: 'green',  indexIcon: 'fas fa-headphones' },
  [CONTENT_TYPES.LOCATION]: { label: 'Location',         icon: 'fas fa-map-marker-alt', accent: 'green',  indexIcon: 'fas fa-map-marker-alt' },
  // Phase 2 — §8c content types
  [CONTENT_TYPES.SPREADSHEET]: { label: 'Spreadsheet',  icon: 'fas fa-table-cells',     accent: 'green',  indexIcon: 'fas fa-table-cells' },
  [CONTENT_TYPES.CALENDAR]:    { label: 'Calendar',     icon: 'fas fa-calendar-days',   accent: 'gold',   indexIcon: 'fas fa-calendar-days' },
  [CONTENT_TYPES.SYSLOG]:      { label: 'System Log',   icon: 'fas fa-terminal',        accent: 'cyan',   indexIcon: 'fas fa-terminal' },
  [CONTENT_TYPES.CREDENTIALS]: { label: 'Credentials',  icon: 'fas fa-key',             accent: 'red',    indexIcon: 'fas fa-key' },
  [CONTENT_TYPES.BANKING]:     { label: 'Banking',      icon: 'fas fa-building-columns', accent: 'green', indexIcon: 'fas fa-building-columns' },
  // Phase 2 wave 3 — §8c continued
  [CONTENT_TYPES.GALLERY]:  { label: 'Image Gallery', icon: 'fas fa-images',         accent: 'purple', indexIcon: 'fas fa-images' },
  [CONTENT_TYPES.DOCUMENT]: { label: 'Document',      icon: 'fas fa-file-lines',     accent: 'gold',   indexIcon: 'fas fa-file-lines' },
  [CONTENT_TYPES.CHATLOG]:  { label: 'Chat Log',      icon: 'fas fa-comments',       accent: 'cyan',   indexIcon: 'fas fa-comments' },
  // Phase 2 wave 4 — §8c catalog complete
  [CONTENT_TYPES.RECORD]:    { label: 'Records / DB', icon: 'fas fa-database',          accent: 'cyan',   indexIcon: 'fas fa-database' },
  [CONTENT_TYPES.SCHEMATIC]: { label: 'Schematic',    icon: 'fas fa-compass-drafting',  accent: 'purple', indexIcon: 'fas fa-compass-drafting' },
  [CONTENT_TYPES.NOTE]:      { label: 'Note',         icon: 'fas fa-note-sticky',       accent: 'gold',   indexIcon: 'fas fa-note-sticky' },
  [CONTENT_TYPES.MALWARE]:   { label: 'Malware',      icon: 'fas fa-biohazard',         accent: 'red',    indexIcon: 'fas fa-biohazard' },
};

// ═══════════════════════════════════════════════════════════
//  ENVELOPE — mail vs file (2026-07-13, #37)
//  An entry has always worn an EMAIL envelope (from / subject / received)
//  even when it was a camera feed. A terminal is a MACHINE: machines hold
//  FILES. `envelope: 'file'` swaps the envelope (filename / path / owner-node /
//  modified / size) and suppresses every mail affordance — reply,
//  add-to-contacts, threading, the delivery toast, and the master-contact
//  auto-create (a file's owner is a NODE like SECCAM-B2, not an Agent).
//  Default stays 'mail', so every existing entry is untouched.
// ═══════════════════════════════════════════════════════════

/** Per-type file extension + the type-aware "4th cell" of the file header. */
export const FILE_TYPE_INFO = {
  [CONTENT_TYPES.GALLERY]:     { ext: 'img',  countKey: 'images',       countLabel: 'Frames' },
  [CONTENT_TYPES.SPREADSHEET]: { ext: 'xls',  countKey: 'rows',         countLabel: 'Rows' },
  [CONTENT_TYPES.SYSLOG]:      { ext: 'log',  countKey: 'lines',        countLabel: 'Lines' },
  [CONTENT_TYPES.RECORD]:      { ext: 'db',   countKey: 'records',      countLabel: 'Subjects' },
  [CONTENT_TYPES.CREDENTIALS]: { ext: 'vault', countKey: 'entries',     countLabel: 'Logins' },
  [CONTENT_TYPES.CHATLOG]:     { ext: 'chat', countKey: 'messages',     countLabel: 'Messages' },
  [CONTENT_TYPES.CALENDAR]:    { ext: 'cal',  countKey: 'events',       countLabel: 'Events' },
  [CONTENT_TYPES.DOCUMENT]:    { ext: 'doc',  countKey: 'paragraphs',   countLabel: 'Blocks' },
  [CONTENT_TYPES.BANKING]:     { ext: 'fin',  countKey: 'transactions', countLabel: 'Txns' },
  [CONTENT_TYPES.SCHEMATIC]:   { ext: 'plan', countKey: 'annotations',  countLabel: 'Markers' },
  [CONTENT_TYPES.MALWARE]:     { ext: 'exe' },
  [CONTENT_TYPES.PAYLOAD]:     { ext: 'exe' },
  [CONTENT_TYPES.AVLOG]:       { ext: 'media' },
  [CONTENT_TYPES.DOSSIER]:     { ext: 'file' },
  [CONTENT_TYPES.LOCATION]:    { ext: 'pin' },
  [CONTENT_TYPES.NOTE]:        { ext: 'txt' },
  [CONTENT_TYPES.EDDIES]:      { ext: 'creds' },
  [CONTENT_TYPES.MESSAGE]:     { ext: 'txt' },
};

/** Content types that read as FILES by default in the composer (GM can flip). */
export const FILE_DEFAULT_TYPES = [
  CONTENT_TYPES.GALLERY, CONTENT_TYPES.SPREADSHEET, CONTENT_TYPES.SYSLOG,
  CONTENT_TYPES.RECORD, CONTENT_TYPES.CREDENTIALS, CONTENT_TYPES.SCHEMATIC,
  CONTENT_TYPES.MALWARE, CONTENT_TYPES.PAYLOAD, CONTENT_TYPES.CHATLOG,
  CONTENT_TYPES.AVLOG, CONTENT_TYPES.DOCUMENT,
];

/** Human byte size ("84 KB" / "14.2 MB"). */
function _humanSize(bytes) {
  if (!(bytes > 0)) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / 1048576;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * Derive a plausible file size from the content itself — the GM types a name,
 * not a spec sheet. Images dominate (≈1.2 MB/frame); text scales with volume.
 */
export function deriveFileSize(contentType, cd = {}) {
  const n = (arr) => (Array.isArray(arr) ? arr.length : 0);
  switch (contentType) {
    case CONTENT_TYPES.GALLERY:
      // A live feed is a STREAM — it has no size, and that's the point.
      if (cd.mode === 'feed') return '';
      return _humanSize(n(cd.images) * 1250000);
    case CONTENT_TYPES.AVLOG:     return _humanSize(24000000);
    case CONTENT_TYPES.SPREADSHEET: return _humanSize(2400 + n(cd.rows) * 420 + n(cd.columns) * 90);
    case CONTENT_TYPES.SYSLOG:    return _humanSize(1200 + n(cd.lines) * 130);
    case CONTENT_TYPES.RECORD:    return _humanSize(3600 + n(cd.records) * 2400);
    case CONTENT_TYPES.CHATLOG:   return _humanSize(900 + n(cd.messages) * 180);
    case CONTENT_TYPES.DOCUMENT:  return _humanSize(4800 + n(cd.paragraphs) * 900);
    case CONTENT_TYPES.CALENDAR:  return _humanSize(1800 + n(cd.events) * 260);
    case CONTENT_TYPES.BANKING:   return _humanSize(2200 + n(cd.transactions) * 150);
    case CONTENT_TYPES.CREDENTIALS: return _humanSize(800 + n(cd.entries) * 120);
    case CONTENT_TYPES.SCHEMATIC: return _humanSize(3400000);
    case CONTENT_TYPES.MALWARE:   return _humanSize(1150000);
    case CONTENT_TYPES.PAYLOAD:   return _humanSize(Number(cd.size) || 890000);
    default:                      return _humanSize(2600);
  }
}

/** Slug a subject into a filename stem ("Payroll Q3" → "payroll_q3"). */
export function slugFilename(s) {
  return String(s || 'untitled').trim().toLowerCase()
    .replace(/['"’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'untitled';
}

/** Suggest a filename for a typed entry ("dock-level-b.feed"). */
export function suggestFilename(contentType, cd = {}, subject = '') {
  // A feed gallery is a stream, not a picture file.
  const ext = (contentType === CONTENT_TYPES.GALLERY && cd.mode === 'feed')
    ? 'feed' : (FILE_TYPE_INFO[contentType]?.ext || 'dat');
  return `${slugFilename(subject || FILE_TYPE_INFO[contentType]?.ext || 'file')}.${ext}`;
}

/**
 * Resolve an entry's envelope into a view-model. `mail` returns `{ isFile:false }`
 * (callers keep their existing sender header); `file` returns the file header
 * fields — every one of them DERIVED when not authored, so a GM who types only
 * a filename still gets a believable file.
 *
 * `isStream` (a live camera feed) is the load-bearing one: a stream has no
 * size and no modified date ("LIVE"), and — via the exfil resolver — cannot be
 * copied off the machine at all. You save a FRAME instead.
 */
export function resolveEnvelope(entry = {}) {
  const isFile = entry.envelope === 'file';
  if (!isFile) return { isFile: false };
  const type = entry.contentType || CONTENT_TYPES.MESSAGE;
  const cd = entry.contentData || {};
  const f = entry.file || {};
  const info = getContentTypeInfo(type);
  const meta = FILE_TYPE_INFO[type] || {};
  const isStream = type === CONTENT_TYPES.GALLERY && cd.mode === 'feed';

  const filename = f.filename || suggestFilename(type, cd, entry.subject);
  let path = f.path || '';
  if (path && !path.endsWith('/')) path += '/';

  // The type-aware 4th cell (Frames / Rows / Lines / Subjects …).
  let countLabel = '', countValue = '';
  if (isStream) { countLabel = 'Channels'; countValue = String((cd.images || []).length); }
  else if (meta.countKey && Array.isArray(cd[meta.countKey])) {
    countLabel = meta.countLabel; countValue = String(cd[meta.countKey].length);
  }
  // "1 Frames" reads like a bug. Singularize the label when there's exactly one.
  if (countValue === '1' && countLabel.endsWith('s')) countLabel = countLabel.slice(0, -1);

  let modified = f.modified || entry.timestamp || '';
  let modifiedLabel;
  if (isStream) modifiedLabel = 'LIVE';
  else if (modified) {
    try { modifiedLabel = formatCyberDate(modified, { dateOnly: true }); } catch { modifiedLabel = String(modified); }
  } else modifiedLabel = '—';

  return {
    isFile: true, isStream,
    filename,
    path, fullPath: `${path}${filename}`,
    owner: f.owner || entry.from || '',
    modified, modifiedLabel,
    size: isStream ? 'streaming' : (f.size || deriveFileSize(type, cd) || '—'),
    // A live feed announces itself as a CAMERA FEED, not an "Image Gallery" —
    // the mode is the identity here, not the underlying content type.
    typeLabel: isStream ? 'Camera Feed' : info.label,
    typeIcon: isStream ? 'fas fa-tower-broadcast' : info.icon,
    accent: isStream ? 'green' : info.accent,
    countLabel, countValue, hasCount: !!countValue,
  };
}

/** Accent palette key → hex (index chip / dot rendering). */
export const ACCENT_HEX = Object.freeze({
  red: '#F65261', cyan: '#19f3f7', gold: '#f7c948',
  green: '#00ff41', purple: '#a855f7', danger: '#ff0033', muted: '#888888',
});

/** Resolve display info for a type, falling back to MESSAGE. */
export function getContentTypeInfo(type) {
  return CONTENT_TYPE_INFO[type] ?? CONTENT_TYPE_INFO[CONTENT_TYPES.MESSAGE];
}

/**
 * The type a message should be LABELLED as in any list/index/sidebar — i.e. the
 * cover type for a disguised payload a player hasn't sniffed or run yet.
 * `enrichContent` already swaps the disguise for the detail view; list surfaces
 * read `contentType` straight off the stored message, which announced
 * "Payload" in the sidebar and blew the disguise before it was ever opened.
 * Every surface that shows a type label/icon must route through this.
 * @param {{contentType?:string, contentData?:object}} msg
 * @param {{isGM?:boolean}} [ctx]
 * @returns {string|null} the type to display (null = a plain message)
 */
export function displayContentType(msg, { isGM = false } = {}) {
  const type = msg?.contentType;
  if (!type || type === CONTENT_TYPES.MESSAGE) return null;
  if (type === CONTENT_TYPES.PAYLOAD && !isGM) {
    const cd = msg.contentData || {};
    if (cd.disguised && !cd.sniffed && !cd.executed) {
      const cover = cd.disguiseType || CONTENT_TYPES.NOTE;
      return cover === CONTENT_TYPES.MESSAGE ? null : cover;
    }
  }
  return type;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHS_LONG = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/**
 * Authorable color names shared across content types (cells, calendar
 * categories, banking icons, status pills). CSS defines `.ncm-ct-c--<name>` /
 * `.ncm-ct-bg--<name>` and `[data-ct-color="<name>"]{--ct-c:…}` for each — the
 * one palette that kills the monochrome. Unknown names fall through to muted.
 */
export const CT_COLORS = ['green', 'gold', 'cyan', 'red', 'amber', 'purple', 'blue', 'pink', 'muted'];
function _colorName(c) { return CT_COLORS.includes(c) ? c : 'muted'; }

/** Compact "2h 14m" / "0m" label for a millisecond span (clamped at 0). */
function _durationLabel(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h >= 1) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m >= 1) return `${m}m`;
  return s > 0 ? `${s}s` : '0m';
}

/** Parse a diegetic clock string ("03:47" or "1:02:15") → seconds (0 = unparseable). */
function _parseClock(str) {
  const m = String(str || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return 0;
  return m[3] != null
    ? (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))
    : (Number(m[1]) * 60 + Number(m[2]));
}

/**
 * PAYLOAD effect catalog — a utility program's effect type drives its label,
 * icon, one-line blurb, and which module-native routine `runPayloadExecute`
 * applies. `adjudicate` is the always-works fallback (mark run + alert the GM).
 * Unknown/legacy effect types resolve to `adjudicate`.
 */
export const PAYLOAD_EFFECTS = Object.freeze({
  icebreaker:  { label: 'Icebreaker',   icon: 'fas fa-unlock-keyhole',   blurb: 'unseals encrypted files on the host system' },
  skeletonKey: { label: 'Skeleton Key', icon: 'fas fa-key',              blurb: 'clears account & network lockouts on the host' },
  scanner:     { label: 'Scanner',      icon: 'fas fa-satellite-dish',   blurb: 'reveals hidden accounts & off-net files' },
  jammer:      { label: 'Jammer',       icon: 'fas fa-tower-broadcast',  blurb: 'suppresses the machine uplink (LOCAL ONLY)' },
  adjudicate:  { label: 'Program',      icon: 'fas fa-bolt',             blurb: 'runs a custom routine (GM adjudicates the effect)' },
});
export function payloadEffectInfo(type) {
  return PAYLOAD_EFFECTS[type] || PAYLOAD_EFFECTS.adjudicate;
}

/**
 * Build a minimal cover-type contentData for a disguised payload — the payload's
 * name/description mapped into the masquerade type so it reads as an innocuous
 * file. Only the common covers are shaped; anything else falls back to a note.
 * Used by enrichContent's disguise passthrough (players see the cover; the GM
 * always sees the real payload + a red tag).
 */
function _disguiseCover(type, cd) {
  const name = cd.name || 'file';
  const desc = cd.description || '';
  switch (type) {
    case CONTENT_TYPES.NOTE:    return { text: desc || name, title: name, color: 'gold' };
    case CONTENT_TYPES.EDDIES:  return { amount: 0, claimed: false, note: desc };
    case CONTENT_TYPES.DOSSIER: return { targetName: name, classification: '', sections: desc ? [{ title: 'NOTES', body: desc }] : [] };
    case CONTENT_TYPES.MESSAGE:
    default:                    return null; // MESSAGE reads body/from off the entry, not contentData
  }
}

/** Syslog severity synonyms → a render class. */
const SEV_CLASS = {
  info: 'info', notice: 'info',
  ok: 'ok', success: 'ok', pass: 'ok',
  warn: 'warn', warning: 'warn',
  err: 'err', error: 'err', crit: 'err', critical: 'err', alert: 'err', fail: 'err',
  debug: 'debug', trace: 'debug',
};
/** Severity class → badge icon. */
const SEV_ICON = {
  info: 'fas fa-circle-info', ok: 'fas fa-circle-check',
  warn: 'fas fa-triangle-exclamation', err: 'fas fa-circle-xmark', debug: 'fas fa-bug',
};

/** Common status words → a pill color (spreadsheet status column). */
const STATUS_COLOR = {
  CLEARED: 'green', OK: 'green', ACTIVE: 'green', VALID: 'green', PAID: 'green', APPROVED: 'green', DONE: 'green',
  HELD: 'amber', PENDING: 'amber', REVIEW: 'amber', PROCESSING: 'amber', WARNING: 'amber',
  DENIED: 'red', FAILED: 'red', BLOCKED: 'red', FLAGGED: 'red', REJECTED: 'red', OVERDUE: 'red',
};

/**
 * RECORD typed-field catalog (records redesign 2026-07-12). A record = a subject
 * (portrait/name/status/flag) + a flexible list of typed fields drawn from this
 * registry. Shared by the enricher (render) and DataShardComposer (palette +
 * inputs) so a field looks/authors the same everywhere.
 *   type — how it renders/authors: text · number(+unit) · date(CyberTimePicker) ·
 *          threat(1–4 meter) · rating(1–5 stars) · flag(boolean chip) ·
 *          image(FilePicker→evidence thumb) · textarea(note, full-width) · customkv
 *   group — palette section. `full` fields span both viewer columns.
 */
export const RECORD_FIELD_KINDS = Object.freeze({
  // ── core ──
  phone:    { label: 'Phone',       icon: 'fas fa-phone',                   group: 'core',     type: 'text',     ph: '+1 555-0000' },
  alias:    { label: 'Alias',       icon: 'fas fa-user-secret',             group: 'core',     type: 'text',     ph: "'Handle'" },
  address:  { label: 'Address',     icon: 'fas fa-location-dot',            group: 'core',     type: 'text',     ph: 'district, street', full: true },
  date:     { label: 'Date',        icon: 'fas fa-calendar-day',            group: 'core',     type: 'date' },
  id:       { label: 'ID / serial', icon: 'fas fa-id-card',                 group: 'core',     type: 'text',     ph: 'NC-00000' },
  note:     { label: 'Note',        icon: 'fas fa-note-sticky',             group: 'core',     type: 'textarea', ph: 'freeform note…', full: true },
  threat:   { label: 'Threat',      icon: 'fas fa-triangle-exclamation',    group: 'core',     type: 'threat' },
  // ── security & threat ──
  clearance:{ label: 'Clearance',   icon: 'fas fa-shield-halved',           group: 'security', type: 'text',     ph: 'ALPHA / L4' },
  priors:   { label: 'Priors',      icon: 'fas fa-gavel',                   group: 'security', type: 'text',     ph: 'assault, B&E', full: true },
  bounty:   { label: 'Bounty',      icon: 'fas fa-sack-dollar',             group: 'security', type: 'number',   ph: '5000', unit: 'eb' },
  warrant:  { label: 'Warrant',     icon: 'fas fa-file-circle-exclamation', group: 'security', type: 'flag' },
  armed:    { label: 'Armed & dangerous', icon: 'fas fa-gun',               group: 'security', type: 'flag' },
  // ── employment & org ──
  org:      { label: 'Org',         icon: 'fas fa-building',                group: 'work',     type: 'text',     ph: 'Arasaka' },
  role:     { label: 'Role / title',icon: 'fas fa-user-tie',                group: 'work',     type: 'text',     ph: 'title' },
  dept:     { label: 'Department',  icon: 'fas fa-sitemap',                 group: 'work',     type: 'text',     ph: 'Counterintel' },
  empId:    { label: 'Employee ID', icon: 'fas fa-id-badge',                group: 'work',     type: 'text',     ph: 'EMP-0000' },
  grade:    { label: 'Pay grade',   icon: 'fas fa-layer-group',             group: 'work',     type: 'text',     ph: 'G7' },
  // ── medical ──
  blood:    { label: 'Blood type',  icon: 'fas fa-droplet',                 group: 'medical',  type: 'text',     ph: 'O−' },
  allergies:{ label: 'Allergies',   icon: 'fas fa-viruses',                 group: 'medical',  type: 'text',     ph: 'penicillin' },
  cyberware:{ label: 'Cyberware',   icon: 'fas fa-microchip',               group: 'medical',  type: 'text',     ph: 'Kerenzikov Mk.3', full: true },
  condition:{ label: 'Condition',   icon: 'fas fa-heart-pulse',             group: 'medical',  type: 'text',     ph: 'stable' },
  nextofkin:{ label: 'Next of kin', icon: 'fas fa-people-roof',             group: 'medical',  type: 'text',     ph: 'name' },
  trauma:   { label: 'Trauma tier', icon: 'fas fa-truck-medical',           group: 'medical',  type: 'text',     ph: 'Platinum' },
  // ── asset & vehicle ──
  vehicle:  { label: 'Make / model',icon: 'fas fa-car',                     group: 'asset',    type: 'text',     ph: 'Quadra Type-66' },
  plate:    { label: 'Plate',       icon: 'fas fa-rectangle-list',          group: 'asset',    type: 'text',     ph: 'NC-8842' },
  vin:      { label: 'VIN / serial',icon: 'fas fa-barcode',                 group: 'asset',    type: 'text',     ph: 'serial' },
  owner:    { label: 'Owner',       icon: 'fas fa-user',                    group: 'asset',    type: 'text',     ph: 'name' },
  reg:      { label: 'Registration',icon: 'fas fa-clipboard-check',         group: 'asset',    type: 'text',     ph: 'impounded / valid' },
  // ── power (module integration) ──
  image:    { label: 'Evidence img',icon: 'fas fa-image',                   group: 'power',    type: 'image' },
  rating:   { label: 'Rating',      icon: 'fas fa-ranking-star',            group: 'power',    type: 'rating' },
  // ── freeform ──
  custom:   { label: 'Custom',      icon: 'fas fa-tag',                     group: 'freeform', type: 'customkv', ph: 'value' },
});

/** Legacy top-level record keys → their field kind (back-compat migration). */
const RECORD_LEGACY_MAP = { role: 'role', org: 'org', address: 'address', note: 'note' };

/** DB-kind quick-starts — the field kinds a new subject card seeds with. */
export const RECORD_DB_KINDS = Object.freeze({
  personnel: { label: 'Personnel',      seed: ['role', 'org', 'id', 'clearance'] },
  criminal:  { label: 'Criminal / BOLO',seed: ['alias', 'threat', 'date', 'priors', 'bounty'] },
  employee:  { label: 'Employee',       seed: ['role', 'org', 'dept', 'empId', 'grade'] },
  medical:   { label: 'Medical',        seed: ['blood', 'allergies', 'cyberware', 'condition', 'nextofkin'] },
  vehicle:   { label: 'Vehicle / Asset',seed: ['vehicle', 'plate', 'vin', 'owner', 'reg'] },
  contacts:  { label: 'Contacts',       seed: ['phone', 'alias', 'address', 'note'] },
});
export function recordFieldInfo(kind) { return RECORD_FIELD_KINDS[kind] || null; }

/** Banking transaction category → { icon, color } for the color-coded ledger. */
const BANK_CAT = {
  transfer: { icon: 'fas fa-arrow-right-arrow-left', color: 'cyan' },
  deposit: { icon: 'fas fa-arrow-down', color: 'green' },
  inbound: { icon: 'fas fa-arrow-down', color: 'green' },
  withdrawal: { icon: 'fas fa-arrow-up', color: 'amber' },
  services: { icon: 'fas fa-user-shield', color: 'purple' },
  wire: { icon: 'fas fa-bolt', color: 'gold' },
  payment: { icon: 'fas fa-receipt', color: 'pink' },
  payroll: { icon: 'fas fa-users', color: 'blue' },
  flagged: { icon: 'fas fa-flag', color: 'red' },
};

/**
 * SCHEMATIC marker types (redesign 2026-07-12) — a heist-map marker set. Shared
 * by the enricher (render) and DataShardComposer (palette + stage). `color` is a
 * CT_COLORS key (the pin tint / legend group).
 */
export const SCHEM_MARKERS = Object.freeze({
  pin:       { label: 'Pin',       icon: 'fas fa-location-dot',         color: 'cyan',   group: 'Points' },
  entry:     { label: 'Entry',     icon: 'fas fa-right-to-bracket',     color: 'green',  group: 'Entry / Exit' },
  exit:      { label: 'Exit',      icon: 'fas fa-right-from-bracket',   color: 'green',  group: 'Entry / Exit' },
  door:      { label: 'Door',      icon: 'fas fa-door-closed',          color: 'cyan',   group: 'Access' },
  window:    { label: 'Window',    icon: 'fas fa-table-cells-large',    color: 'cyan',   group: 'Access' },
  guard:     { label: 'Guard',     icon: 'fas fa-user-shield',          color: 'red',    group: 'Security' },
  camera:    { label: 'Camera',    icon: 'fas fa-video',                color: 'amber',  group: 'Security' },
  alarm:     { label: 'Alarm',     icon: 'fas fa-bell',                 color: 'red',    group: 'Security' },
  hazard:    { label: 'Hazard',    icon: 'fas fa-triangle-exclamation', color: 'red',    group: 'Security' },
  objective: { label: 'Objective', icon: 'fas fa-bullseye',            color: 'gold',   group: 'Objective' },
  loot:      { label: 'Loot',      icon: 'fas fa-sack-dollar',          color: 'gold',   group: 'Objective' },
  terminal:  { label: 'Terminal',  icon: 'fas fa-terminal',             color: 'purple', group: 'Objective' },
});
export function schemMarkerInfo(type) { return SCHEM_MARKERS[type] || SCHEM_MARKERS.pin; }
/** Legend group order. */
const SCHEM_GROUP_ORDER = ['Entry / Exit', 'Access', 'Security', 'Objective', 'Points'];

/** 0-based column index → spreadsheet letter (A, B, … Z, AA …). */
function _colLetter(n) {
  let s = ''; n = Number(n);
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
/** Parse a possibly-formatted numeric string ("240,000" → 240000). */
function _parseNum(v) {
  const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

/** Current time in ms, honoring the configured time provider (countdowns rule). */
function _nowMs() {
  const ts = game.nightcity?.timeService;
  if (ts?.getCurrentTimeMs) { try { return ts.getCurrentTimeMs(); } catch (_) { /* fall through */ } }
  return Date.parse(new Date().toISOString());
}

/**
 * Camera-feed clock label (HH:MM:SS). Two live sources — the gallery's
 * authored `clock` mode picks one (see GALLERY enricher):
 *  - 'game' (default) — the TIME PROVIDER (`_nowMs`), so the feed is in sync
 *    with every other NCM clock and Simple Calendar / world-time / disguised
 *    modes all move it. Caveat: in `manual` / `world-time` the game clock only
 *    advances when the GM advances it, so the feed sits on a frozen timestamp.
 *  - 'real'  — the wall clock, so the cameras keep ticking even when game time
 *    is paused or manual. Display-only flavor (NOT a countdown/expiry), which
 *    is why it may bypass the provider — the standing rule still holds for
 *    anything that expires.
 * Both format through formatCyberDate, so the 12h/24h setting applies.
 */
function _feedClockLabel(mode = 'game') {
  const ms = mode === 'real' ? Date.now() : _nowMs();
  try {
    return formatCyberDate(new Date(ms).toISOString(), { timeOnly: true, seconds: true });
  } catch (_) {
    const d = new Date(ms);
    return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  }
}

/**
 * Compact time-aware countdown label for calendar events ("in 1d 4h" /
 * "3h ago" / "now") — the unified When picker stores real clock times, so
 * the label carries hours, not just days.
 */
function _relCal(diffMs) {
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  let span;
  if (d >= 1) span = `${d}d${h ? ` ${h}h` : ''}`;
  else if (h >= 1) span = `${h}h${m ? ` ${m}m` : ''}`;
  else if (m >= 1) span = `${m}m`;
  else return 'now';
  return past ? `${span} ago` : `in ${span}`;
}

/**
 * Per-type contentData enrichers. Each receives the raw `contentData` plus the
 * full `entry` and a `ctx` and returns the processed contentData the partial
 * reads. Types with no enricher render their raw contentData as-is.
 * @type {Object<string, (cd:object, entry:object, ctx:object)=>object>}
 */
const ENRICHERS = {
  // EDDIES — a cred transfer (redesign 2026-07-14). A physical eb-chip drop:
  // amount, the SOURCE (the entry's From — who left it), an optional signed
  // note, and a CLAIM. Claiming re-renders the entry with `claimed:true`; the
  // `justClaimed` window (claimedAt within ~12s, the location-reveal precedent —
  // real-time Date is fine, it's display-only) plays the transfer FX once.
  [CONTENT_TYPES.EDDIES]: (cd, entry = {}) => {
    // `justClaimed` keys on `claimedRealMs` (REAL time), NOT `claimedAt` (game
    // time) — comparing a game-time stamp to Date.now() never matches unless the
    // world runs a real-time clock, which is why the claim animation "didn't
    // play". The location-reveal `justRevealed` has the same real-time rule.
    let justClaimed = false;
    if (cd.claimed && cd.claimedRealMs) {
      const dt = Date.now() - Number(cd.claimedRealMs);
      justClaimed = dt >= 0 && dt < 12000;
    }
    return {
      ...cd,
      amount: Number(cd.amount) || 0,
      amountFormatted: (cd.amount ?? 0).toLocaleString(),
      source: cd.source || entry.from || '',
      claimedByName: cd.claimedBy ? (game.actors?.get(cd.claimedBy)?.name ?? 'Unknown') : '',
      justClaimed,
    };
  },

  // DOSSIER — FUI "target file" (redesign 2026-07-13). Authored contentData:
  //   { targetName, targetAlias?, targetImage?, linkedActorId?, classification?,
  //     stats: { threat?('LOW'|'MEDIUM'|'HIGH'|'EXTREME'), affiliation?, lastKnownLocation? },
  //     sections: [{ heading, body, redacted?, declassified? }],
  //     declassify?, declassifySkill?, declassifyDV?, traceOnFail?,
  //     faceLocked?, faceUnlockSkill?, faceUnlockDV?, faceTraceOnFail?,   // masked identity
  //     profile?: { enabled, title?, visibility('open'|'encrypted'|'gm'),  // combat profile
  //                 skill?, dv?, stats:['body',…], skills:['Handgun',…], decrypted? } }
  // The profile reads the linked world actor's REAL stats at render time —
  // never stored, so a sheet edit shows up on the next open. A masked identity
  // (`faceLocked`) keeps the portrait AND real name out of a player's DOM
  // (kind 'dossier-face'); an encrypted profile keeps the VALUES out
  // (kind 'dossier-profile'). GM always sees everything + force-REVEAL chips.
  [CONTENT_TYPES.DOSSIER]: (cd, entry, ctx = {}) => {
    const isGM = !!ctx.isGM;
    const THREAT_LEVELS = { LOW: 1, MEDIUM: 2, HIGH: 3, EXTREME: 4 };
    const threatLabel = String(cd.stats?.threat || '').toUpperCase();
    const threatLevel = THREAT_LEVELS[threatLabel] || 0;

    // Masked identity — portrait + real name never reach a player's DOM.
    const masked = !!cd.faceLocked && !isGM;
    const linkedActorImg = cd.linkedActorId ? game.actors?.get(cd.linkedActorId)?.img : null;

    // Combat profile — live read from the linked world actor (never stored).
    let profile = null;
    const prof = cd.profile;
    if (prof?.enabled && cd.linkedActorId) {
      const actor = game.actors?.get(cd.linkedActorId);
      const gmOnly = prof.visibility === 'gm';
      const encrypted = prof.visibility === 'encrypted' && !prof.decrypted && !isGM;
      if (actor && (!gmOnly || isGM)) {
        const readStat = (k) => {
          const s = actor.system?.stats?.[String(k).toLowerCase()];
          return s?.value ?? (typeof s === 'number' ? s : 0);
        };
        // Encrypted for a player → the value never enters the view-model.
        const stats = (prof.stats || []).filter(Boolean).map(k => ({
          k: String(k).toUpperCase(),
          vLabel: encrypted ? '◈' : String(readStat(k)),
        }));
        const svc = game.nightcity?.skillService;
        const skills = (prof.skills || []).filter(Boolean).map(name => {
          if (encrypted) return { name, vLabel: '◈' };
          let total = 0;
          try { total = svc?.getAvailableSkills?.(actor, [name])?.[0]?.total ?? 0; } catch { /* 0 */ }
          return { name, vLabel: String(total) };
        });
        if (stats.length || skills.length) {
          profile = {
            title: prof.title || 'COMBAT PROFILE',
            actorName: actor.name,
            stats, skills, hasStats: stats.length > 0, hasSkills: skills.length > 0,
            encrypted, gmOnly,
            playersEncrypted: prof.visibility === 'encrypted' && !prof.decrypted && isGM,
            dv: Number(prof.dv) || 13,
          };
        }
      }
    }

    return {
      ...cd,
      hasSections: cd.sections?.length > 0,
      threatIsHigh: threatLevel >= 3,
      threatLevel, threatLabel,
      threatSegs: threatLevel ? [1, 2, 3, 4].map(n => ({ on: n <= threatLevel })) : [],
      linkedActorImg: masked ? null : linkedActorImg,
      targetImage: masked ? null : (cd.targetImage || null),
      displayName: masked ? '██████ ██████' : (cd.targetName || 'Unknown'),
      identityMasked: masked,
      gmMasked: !!cd.faceLocked && isGM,
      faceUnlockDV: Number(cd.faceUnlockDV) || 15,
      // Delegated [data-doss-sheet] listener works in every viewer — no
      // interactive gate needed (the terminal passes interactive:false).
      canOpenSheet: isGM && !!cd.linkedActorId && !!game.actors?.get(cd.linkedActorId),
      profile,
      // Cosmetic file reference for the FUI topbar.
      fileRef: 'NC-DB-' + String(entry?.messageId || entry?.id || '0000').replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase(),
      // DECLASSIFY affordance (contentUnlock kind 'dossier').
      canDeclassify: !!cd.declassify && (cd.sections || []).some(s => s.redacted),
      declassifyDV: cd.declassifyDV || 15,
    };
  },

  // PAYLOAD — a UTILITY PROGRAM the operator runs (§8c overhaul 2026-07-12; the
  // MALWARE sibling is the hostile artifact). Executing runs the configured
  // effect (icebreaker/skeletonKey/scanner/jammer/adjudicate + optional linked
  // Macro), optionally gated by a roll, optionally timed (active → auto-expires).
  // Authored contentData:
  //   { name, program?, version?, sizeLabel?, publisher?, signed?, charges?,
  //     description?,
  //     effect: { type, duration(ms), macroId? },
  //     requirements: [{ kind:'uplink'|'admin'|'note', label }],
  //     executeRequire?, executeSkill?, executeDV?, traceOnFail?,
  //     disguised?, disguiseType?, sniffDV?, sniffed?,
  //     output: [{ text, sev }],            // authored console run log
  //     executed?, executedBy?, executedAt?, active?, expiresAt?, killed?,
  //     scanReport? }
  // Runtime states: idle → (executing, UI-only) → active (timed) | done.
  [CONTENT_TYPES.PAYLOAD]: (cd, entry, ctx = {}) => {
    const fx = payloadEffectInfo(cd.effect?.type);
    const duration = Number(cd.effect?.duration) || 0;
    // Live countdown for a timed, still-running effect.
    let expired = false, remainingMs = 0, expiresLabel = '';
    if (cd.active && cd.expiresAt && !cd.killed) {
      const now = (() => { try { return game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now(); } catch { return Date.now(); } })();
      const end = new Date(cd.expiresAt).getTime();
      remainingMs = end - now;
      expired = remainingMs <= 0;
      expiresLabel = _durationLabel(remainingMs);
    }
    const isActive = !!cd.active && !cd.killed && !expired;
    const requirements = (cd.requirements || []).filter(r => r && r.label).map(r => ({
      kind: r.kind || 'note', label: r.label,
      icon: r.kind === 'uplink' ? 'fas fa-tower-broadcast' : r.kind === 'admin' ? 'fas fa-user-shield' : 'fas fa-circle-dot',
    }));
    const output = (cd.output || []).filter(l => l && (l.text || l.text === '')).map(l => ({
      text: l.text || '', sevClass: SEV_CLASS[l.sev] || 'info',
    }));
    return {
      ...cd,
      name: cd.name || 'UNKNOWN.EXE',
      program: cd.program || cd.payloadType || '',   // legacy `payloadType` → program label
      effectType: cd.effect?.type || 'adjudicate',
      effectLabel: fx.label, effectIcon: fx.icon, effectBlurb: fx.blurb,
      isNative: cd.effect?.type && cd.effect.type !== 'adjudicate' && !!PAYLOAD_EFFECTS[cd.effect.type],
      timed: duration > 0,
      durationLabel: duration > 0 ? _durationLabel(duration) : '',
      charges: cd.charges != null ? Number(cd.charges) : null,
      signed: !!cd.signed,
      requirements, hasRequirements: requirements.length > 0,
      output, hasOutput: output.length > 0,
      // Runtime
      executed: !!cd.executed,
      executedByName: cd.executedBy ? (game.actors?.get(cd.executedBy)?.name ?? 'Unknown') : '',
      executedAtLabel: cd.executedAt ? (() => { try { return formatCyberDate(cd.executedAt); } catch { return ''; } })() : '',
      isActive, expired, expiresLabel,
      killed: !!cd.killed,
      scanReport: cd.scanReport || '',
      // Execute affordance: runnable when not spent and (charges left OR untracked).
      canRun: !cd.executed || (isActive === false && cd.charges > 1),
      gated: !!cd.executeRequire,
      executeDV: Number(cd.executeDV) || 15,
      hasMacro: !!cd.effect?.macroId,
      // GM-only disguise tag (players never reach this enricher for a live
      // disguise — enrichContent swaps them to the cover type first).
      disguiseTag: cd.disguised ? (cd.sniffed ? 'DISGUISE BLOWN' : `DISGUISED AS ${String(cd.disguiseType || 'note').toUpperCase()}`) : '',
    };
  },

  // AVLOG — media deck (karaoke playback 2026-07-13). With a real media URL the
  // normal player renders; with NO media but a transcript + parseable duration
  // the deck gets ▶ TRANSCRIPT PLAYBACK: lines light up across the duration
  // (weighted by text length), driven by the [data-av-act] delegated listener
  // below. Speakers auto-color (c1–c4 by order of first appearance).
  [CONTENT_TYPES.AVLOG]: (cd) => {
    // Sealed recording (`locked` + unlockSkill/unlockDV → contentUnlock kind
    // 'avlog') — the media URL and transcript must NOT reach the DOM.
    if (cd.locked) {
      return {
        ...cd, locked: true, mediaUrl: '',
        isVideo: false, embedSrc: '', hasMedia: false, isEmbed: false, isNativeMedia: false,
        transcript: [], canPlayback: false,
        unlockDV: cd.unlockDV || 15,
      };
    }
    const media = resolveMediaEmbed(cd.mediaUrl, cd.mediaType);
    const durationSec = _parseClock(cd.duration);
    const speakers = [];
    let transcript = (cd.transcript || []).filter(l => l && (l.speaker || l.text)).map(l => {
      let si = speakers.indexOf(l.speaker);
      if (si < 0) { speakers.push(l.speaker); si = speakers.length - 1; }
      return { ...l, colorClass: 'c' + ((si % 4) + 1) };
    });
    const canPlayback = media.kind === 'none' && transcript.length > 0 && durationSec > 0;
    if (canPlayback) {
      // Per-line start times — the duration split by text length.
      const weights = transcript.map(l => Math.max(8, String(l.text || '').length));
      const totalW = weights.reduce((a, b) => a + b, 0) || 1;
      let acc = 0;
      transcript = transcript.map((l, i) => {
        const start = Math.round((acc / totalW) * durationSec * 10) / 10;
        acc += weights[i];
        return { ...l, start };
      });
    }
    return {
      ...cd, transcript,
      isVideo: media.isVideo,
      embedSrc: media.src,
      hasMedia: media.kind !== 'none',
      isEmbed: media.kind === 'embed',
      isNativeMedia: media.kind === 'native',
      canPlayback, durationSec,
      waveBars: canPlayback ? Array.from({ length: 36 }, () => ({})) : [],
    };
  },

  // LOCATION — intel postcard (redesign 2026-07-13). Authored contentData:
  //   { locationName, locationImage?, coordinates?, district?, description?,
  //     linkedSceneId?,
  //     controlledBy?, security?(1–4 → LOW/GUARDED/HIGH/LETHAL), heat?,
  //     hours?, access?, approach?, contact?,
  //     locked?, unlockSkill?, unlockDV?, traceOnFail?, revealedAt? }
  // Everything new is optional — a legacy location renders exactly as before.
  // `locked` seals the WHOLE pin (image/coords/district/description/intel are
  // enricher-stripped so nothing leaks in the DOM — only the name survives)
  // until a DECRYPT roll (contentUnlock kind 'location'); the unlock stamps
  // `revealedAt` and a render within the reveal window plays the FUI resolve
  // animation (`justRevealed` — real-time Date is fine, it's display-only).
  [CONTENT_TYPES.LOCATION]: (cd) => {
    if (cd.locked) {
      return {
        locationName: cd.locationName || 'Unknown',
        linkedSceneId: null,
        locked: true,
        unlockDV: Number(cd.unlockDV) || 15,
        securityLevel: 0, securitySegs: [], hasStrip: false,
        intel: [], hasIntel: false,
      };
    }
    const SEC_LABELS = ['', 'LOW', 'GUARDED', 'HIGH', 'LETHAL'];
    const sec = Math.max(0, Math.min(4, parseInt(cd.security) || 0));
    const intel = [
      cd.hours && { k: 'Hours', v: cd.hours },
      cd.access && { k: 'Access', v: cd.access },
      cd.approach && { k: 'Approach', v: cd.approach },
      cd.contact && { k: 'Contact', v: cd.contact },
    ].filter(Boolean);
    let justRevealed = false;
    if (cd.revealedAt) {
      const dt = Date.now() - new Date(cd.revealedAt).getTime();
      justRevealed = dt >= 0 && dt < 12000;
    }
    return {
      ...cd,
      securityLevel: sec,
      securityLabel: SEC_LABELS[sec],
      securitySegs: sec ? [1, 2, 3, 4].map(n => ({ on: n <= sec })) : [],
      hasStrip: !!(cd.controlledBy || sec),
      intel, hasIntel: intel.length > 0,
      justRevealed,
    };
  },

  // SPREADSHEET — authored shape:
  //   { format?, note?,
  //     columns: [ "Label" | { label, type?: text|number|currency|date|status, align? } ],
  //     rows: [ [ value | { value, bold?, color?, bg?, pill?, reason? } ] ],
  //     redacted:[[r,c]], flagged:[[r,c]], flagReasons?:{ "r:c": "..." },
  //     numericCols?:[c], totals?: true|[c], selected?:[r,c] }
  // Flattens to per-cell view-models (formatting classes, status pills) + a
  // cell-reference bar + an optional Σ totals row. Numeric/status columns are
  // inferred from `columns[].type` (or legacy `numericCols`).
  [CONTENT_TYPES.SPREADSHEET]: (cd) => {
    const columns = (cd.columns || []).map(c =>
      (c && typeof c === 'object') ? { label: c.label ?? '', type: c.type || 'text', align: c.align } : { label: c, type: 'text' });
    const numericCols = new Set(cd.numericCols || []);
    const statusCols = new Set();
    columns.forEach((c, i) => {
      if (c.type === 'number' || c.type === 'currency') numericCols.add(i);
      if (c.type === 'status') statusCols.add(i);
    });
    const redacted = new Set((cd.redacted || []).map(([r, c]) => `${r}:${c}`));
    const flagged = new Set((cd.flagged || []).map(([r, c]) => `${r}:${c}`));
    const reasons = cd.flagReasons || {};
    const totalsCols = cd.totals === true ? [...numericCols] : (Array.isArray(cd.totals) ? cd.totals : []);
    const totals = {};
    let flaggedCount = 0, redactedCount = 0;

    const rows = (cd.rows || []).map((row, r) => ({
      cells: (row || []).map((raw, c) => {
        const cell = (raw && typeof raw === 'object') ? raw : { value: raw };
        const isRed = redacted.has(`${r}:${c}`);
        const isFlag = flagged.has(`${r}:${c}`);
        if (isRed) redactedCount++;
        if (isFlag) flaggedCount++;
        const num = numericCols.has(c);
        const isStatus = statusCols.has(c) || !!cell.pill;
        const pillColor = isStatus ? _colorName(cell.color || STATUS_COLOR[String(cell.value).toUpperCase()] || 'muted') : '';
        if (totalsCols.includes(c) && !isRed) totals[c] = (totals[c] || 0) + _parseNum(cell.value);
        return {
          value: cell.value, redacted: isRed, flagged: isFlag, num,
          bold: !!cell.bold,
          colorClass: cell.color ? `ncm-ct-c--${_colorName(cell.color)}` : '',
          bgClass: cell.bg ? `ncm-ct-bg--${_colorName(cell.bg)}` : '',
          isStatus, pillColor,
          reason: reasons[`${r}:${c}`] || cell.reason || '',
        };
      }),
    }));

    // Cell-reference bar — explicit `selected`, else the first flagged cell.
    const sel = cd.selected || (cd.flagged || [])[0] || null;
    let selRef = '', selVal = '', selReason = '';
    if (sel) {
      const [sr, sc] = sel;
      const scell = rows[sr]?.cells[sc];
      if (scell) { scell.selected = true; selRef = `${_colLetter(sc)}${sr + 1}`; selVal = scell.value; selReason = scell.reason; }
    }

    // Σ totals row aligned to columns.
    let totalRow = null;
    if (totalsCols.length) {
      const labelCol = columns.findIndex((_, i) => !totalsCols.includes(i));
      totalRow = columns.map((_, c) => ({
        isTotal: totalsCols.includes(c),
        total: totalsCols.includes(c) ? (totals[c] || 0).toLocaleString() : '',
        label: c === labelCol ? 'TOTAL' : '',
      }));
    }

    return {
      ...cd, columns, rows, colLetters: columns.map((_, i) => _colLetter(i)),
      colCount: columns.length, rowCount: rows.length, flaggedCount, redactedCount,
      selRef, selVal, selReason, hasSelection: !!sel,
      totalRow, hasTotals: totalsCols.length > 0,
      // DECLASSIFY affordance (contentUnlock kind 'spreadsheet') — clears the
      // `redacted` coordinate list; the underlying values were always in rows.
      canDeclassify: !!cd.declassify && redactedCount > 0,
      declassifyDV: cd.declassifyDV || 15,
    };
  },

  // CALENDAR — (redesign 2026-07-13) authored:
  //   { defaultView? ('rail'|'month'), categories?: { name: colorName },
  //     events: [{ title, when (ISO — full date+time preferred; the composer's
  //       When picker writes it), time? (LEGACY free-text display string —
  //       wins over the ISO-derived time chip), location?, who?, note?,
  //       category?, color?, locked?, unlockSkill?, unlockDV?, traceOnFail?,
  //       sceneId? }] }
  //   The view-model: chronologically-sorted `upcoming` + `pastEvents`
  //   (`idx` = the ORIGINAL events index — contentUnlock keys on it), a
  //   time-aware countdown, a `nextEvent` hero strip, and `months` grids for
  //   the month view. A `locked` event is FOG for players: date/title/chips/
  //   scene withheld (never in their DOM), fogged events sort to the END of
  //   upcoming (their rail position must not leak the date) and drop off the
  //   player's month grid entirely; one DECRYPT roll (kind 'calendar')
  //   reveals it. The GM sees the real card + a LOCKED chip.
  [CONTENT_TYPES.CALENDAR]: (cd, entry, ctx = {}) => {
    const isGM = !!ctx.isGM;
    const now = _nowMs();
    const dayMs = 86400000;
    const cats = cd.categories || {};
    const dates = {}; // idx → UTC Date (month-grid placement)

    const all = (cd.events || []).map((ev, i) => {
      const t = ev.when ? Date.parse(ev.when) : NaN;
      const valid = !Number.isNaN(t);
      const d = valid ? new Date(t) : null;
      const diff = valid ? t - now : 0;
      const soon = valid && diff >= 0 && diff < 3 * dayMs;
      const fog = !!ev.locked && !isGM;
      if (valid) dates[i] = d;
      // Time chip: the legacy free-text `time` wins; else derive from an ISO
      // that actually carries a clock (a bare date parses to midnight — don't
      // invent a "00:00" chip for it).
      let timeStr = ev.time || '';
      if (!timeStr && valid && /T\d\d:\d\d/.test(String(ev.when))) {
        try { timeStr = formatCyberDate(d.toISOString(), { timeOnly: true }); } catch (_) { /* chip skipped */ }
      }
      const chips = [];
      if (!fog) {
        if (timeStr) chips.push({ icon: 'fa-regular fa-clock', text: timeStr, color: 'cyan' });
        if (ev.location) chips.push({ icon: 'fas fa-location-dot', text: ev.location, color: 'gold' });
        if (ev.who) chips.push({ icon: 'fas fa-user', text: ev.who, color: 'purple' });
        if (ev.note) chips.push({ icon: 'fas fa-note-sticky', text: ev.note, color: 'pink' });
      }
      return {
        idx: i, _t: valid ? t : Infinity,
        // Epoch ms for the LIVE ticker (refreshCalendarClocks) — deliberately
        // EMPTY for fogged events: a data-ts in the player DOM would leak the
        // withheld date.
        ts: (valid && !fog) ? t : '',
        title: fog ? '' : (ev.title || ''),
        day: fog ? '??' : (d ? String(d.getUTCDate()).padStart(2, '0') : '--'),
        month: fog ? '···' : (d ? MONTHS[d.getUTCMonth()] : ''),
        timeLabel: fog ? '' : (valid ? _relCal(diff) : ''),
        past: !fog && valid && diff < 0,
        soon: !fog && soon,
        color: fog ? 'muted' : _colorName(ev.color || cats[ev.category] || 'cyan'),
        urgency: (!fog && soon) ? Math.max(10, Math.min(100, Math.round(100 - (diff / (3 * dayMs)) * 100))) : 0,
        chips, timeStr,
        isFog: fog,
        lockedGm: !!ev.locked && isGM,
        effDV: Number(ev.unlockDV ?? cd.unlockDV) || 15,
        sceneId: fog ? '' : (ev.sceneId || ''),
        hasScene: !fog && !!ev.sceneId,
        location: fog ? '' : (ev.location || ''),
      };
    });

    // Rail order: upcoming chronological → fogged (authored order — their slot
    // must not hint the date) → past chronological behind the collapse.
    const upcoming = all.filter(e => !e.past && !e.isFog).sort((a, b) => a._t - b._t)
      .concat(all.filter(e => e.isFog));
    const pastEvents = all.filter(e => e.past).sort((a, b) => a._t - b._t);
    const nextEvent = upcoming.find(e => !e.isFog && e._t !== Infinity && e._t >= now) || null;
    const next = nextEvent ? {
      title: nextEvent.title,
      countdown: nextEvent.timeLabel,
      ts: nextEvent.ts,
      meta: [`${nextEvent.month} ${nextEvent.day}`, nextEvent.timeStr, nextEvent.location]
        .filter(Boolean).join(' · '),
    } : null;

    // ── Month grids — one per month holding a visible event, plus "today"'s
    // month. Player-fogged events place NO pip (their date is withheld). ──
    const monthKeys = new Map(); // 'y-m' → {y, m}
    const today = new Date(now);
    const addKey = (d) => monthKeys.set(`${d.getUTCFullYear()}-${d.getUTCMonth()}`, { y: d.getUTCFullYear(), m: d.getUTCMonth() });
    addKey(today);
    for (const e of all) { if (!e.isFog && dates[e.idx]) addKey(dates[e.idx]); }
    const pipsByDay = {}; // 'y-m-d' → [pip]
    for (const e of all) {
      const d = dates[e.idx];
      if (!d || e.isFog) continue;
      const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
      (pipsByDay[k] ||= []).push({ idx: e.idx, title: e.lockedGm ? 'encrypted' : e.title, color: e.color, enc: e.lockedGm });
    }
    const sortedKeys = [...monthKeys.values()].sort((a, b) => (a.y - b.y) || (a.m - b.m));
    const focus = nextEvent && dates[nextEvent.idx]
      ? dates[nextEvent.idx]
      : (pastEvents.length && dates[pastEvents[pastEvents.length - 1].idx]) || today;
    const focusKey = `${focus.getUTCFullYear()}-${focus.getUTCMonth()}`;
    const months = sortedKeys.map(({ y, m }) => {
      const startDow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Monday = 0
      const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const prevDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const cells = [];
      for (let i = startDow - 1; i >= 0; i--) cells.push({ n: prevDays - i, out: true });
      for (let dn = 1; dn <= daysIn; dn++) {
        cells.push({
          n: dn, out: false,
          today: y === today.getUTCFullYear() && m === today.getUTCMonth() && dn === today.getUTCDate(),
          pips: pipsByDay[`${y}-${m}-${dn}`] || [],
        });
      }
      for (let dn = 1; cells.length % 7; dn++) cells.push({ n: dn, out: true });
      return { label: `${MONTHS_LONG[m]} ${y}`, y, m, isFocus: `${y}-${m}` === focusKey, cells };
    });

    const legend = Object.entries(cats).map(([name, color]) => ({ name, color: _colorName(color) }));
    const view = cd.defaultView === 'month' ? 'month' : 'rail';
    return {
      ...cd, legend, hasLegend: legend.length > 0,
      upcoming, pastEvents, pastCount: pastEvents.length,
      hasEvents: all.length > 0, nextEvent: next,
      months, hasMonthNav: months.length > 1,
      view, isRail: view === 'rail', isMonth: view === 'month',
    };
  },

  // SYSLOG — { host?, path?, tz?, prompt?, showLineNumbers?, showFilter?,
  //   scanlines?, lines:[{ ts, sev, actor, msg, mark? }] }. Normalizes severity
  //   to a class + icon + label, counts per severity for the filter legend.
  [CONTENT_TYPES.SYSLOG]: (cd) => {
    const counts = { total: 0 };
    const lines = (cd.lines || []).map(l => {
      const sevClass = SEV_CLASS[String(l.sev || 'info').toLowerCase()] || 'info';
      counts[sevClass] = (counts[sevClass] || 0) + 1; counts.total++;
      return { ...l, sevClass, sevIcon: SEV_ICON[sevClass] || SEV_ICON.info, sevLabel: String(l.sev || 'info').toUpperCase() };
    });
    const legend = ['info', 'ok', 'warn', 'err', 'debug']
      .filter(k => counts[k]).map(k => ({ key: k, count: counts[k], icon: SEV_ICON[k] }));
    return {
      ...cd, lines, lineCount: counts.total, counts, legend,
      showLineNumbers: cd.showLineNumbers !== false,
      showFilter: cd.showFilter !== false && legend.length > 1,
      scanlines: cd.scanlines !== false,
      prompt: cd.prompt || (cd.host ? `root@${cd.host}:~#` : 'root@localhost:~#'),
      showPrompt: cd.showPrompt !== false,
    };
  },

  // CREDENTIALS — { autoReuse?, crackSkill?, crackDV?, entries:[{ host, user,
  //   secret, note?, encrypted?, cracked?, strength?(1-4), reused?,
  //   crackSkill?, crackDV? }] }. Masks locked secrets, auto-flags secrets
  //   reused across hosts (the pivot signal), builds the masked dots. The
  //   CRACK button rolls crackSkill vs crackDV (entry beats vault level;
  //   defaults Interface / DV 15 — see SiphonFlow.runCrack).
  [CONTENT_TYPES.CREDENTIALS]: (cd) => {
    const entries = (cd.entries || []).map(e => ({ ...e, locked: !!e.encrypted && !e.cracked }));
    const seen = {};
    entries.forEach(e => { if (e.secret && !e.locked) seen[e.secret] = (seen[e.secret] || 0) + 1; });
    entries.forEach(e => {
      const auto = (cd.autoReuse !== false && e.secret && !e.locked) ? (seen[e.secret] || 0) : 0;
      e.reused = auto > 1 ? auto : (e.reused || 0);
      e.strengthClass = e.strength ? `s${Math.max(1, Math.min(4, e.strength))}` : '';
      e.dots = '•'.repeat(Math.min(16, Math.max(8, String(e.secret || '').length || 10)));
    });
    return { ...cd, entries, count: entries.length, lockedCount: entries.filter(e => e.locked).length };
  },

  // BANKING — { bankName?, bankLogo?, bankLocation?, bankCode?, bankTagline?,
  //   owner?, accountName?, accountNumber?, accountType?, balance, currency?,
  //   cleared?, held?, allowSiphon?, siphonDV?, siphoned?, transactions:[{ date,
  //   desc, amount, type?, category?, pending? }] }. Formats money, signs txns,
  //   derives running balance (newest-first) + color-coded category icons, and
  //   surfaces the bank "letterhead" lore + the siphon affordance.
  [CONTENT_TYPES.BANKING]: (cd) => {
    let running = cd.balance ?? 0;
    const transactions = (cd.transactions || []).map(t => {
      const credit = t.type ? t.type === 'credit' : (t.amount ?? 0) >= 0;
      const cat = BANK_CAT[String(t.category || '').toLowerCase()] || { icon: 'fas fa-circle-dollar-to-slot', color: credit ? 'green' : 'muted' };
      const amt = Math.abs(t.amount ?? 0);
      const row = {
        ...t, credit, amountFormatted: amt.toLocaleString(), sign: credit ? '+' : '−',
        icon: cat.icon, iconColor: _colorName(cat.color),
        runningFormatted: running.toLocaleString(), pending: !!t.pending,
      };
      running -= credit ? amt : -amt;
      return row;
    });
    // Account status (story hook) → badge label + class; a masked card number.
    const status = String(cd.status || '').toLowerCase();
    const statusMap = { active: 'green', frozen: 'cyan', flagged: 'red', overdrawn: 'amber', vip: 'gold' };
    const num = String(cd.accountNumber || '');
    const last4 = num.replace(/[^0-9a-z]/gi, '').slice(-4);
    return {
      ...cd,
      // Bank identity / lore (letterhead) + card color.
      bankName: cd.bankName || '', bankLogo: cd.bankLogo || '',
      bankLocation: cd.bankLocation || '', bankCode: cd.bankCode || '',
      bankTagline: cd.bankTagline || '',
      bankColor: cd.bankColor || '',      // hex — drives the card gradient
      hasBankId: !!(cd.bankName || cd.bankLogo || cd.bankLocation || cd.bankCode),
      // Account.
      owner: cd.owner || cd.accountName || '',
      accountType: cd.accountType || '',
      currency: cd.currency || '€$',
      maskedNumber: last4 ? `•••• •••• •••• ${last4}` : num,
      status, hasStatus: !!status,
      statusColor: _colorName(statusMap[status] || 'muted'),
      statusLabel: status ? status.toUpperCase() : '',
      transactions, txnCount: transactions.length,
      balanceFormatted: (cd.balance ?? 0).toLocaleString(),
      clearedFormatted: cd.cleared != null ? Number(cd.cleared).toLocaleString() : '',
      heldFormatted: cd.held != null ? Number(cd.held).toLocaleString() : '',
      hasSplit: cd.cleared != null || cd.held != null,
      // Siphon affordance — a frozen account can't be siphoned.
      allowSiphon: !!cd.allowSiphon && !cd.siphoned && status !== 'frozen',
      siphoned: !!cd.siphoned,
      siphonDV: cd.siphonDV || null,
    };
  },

  // GALLERY — photo-app / evidence board, OR (mode:'feed') a live camera
  // multiplex. Authored shape:
  //   { title?, source?, layout?: 'grid'|'strip', mode?: 'feed',
  //     unlockSkill?, unlockDV?, traceOnFail?, camSkill? (loop/cut/control rolls),
  //     images: [{ url, caption?, label?, time?, flagged?, corrupted?, color?,
  //                locked? (ENCRYPTED frame — roll unlockSkill vs unlockDV),
  //                signal? (1–4 bars, feed flavor),
  //                loopDV?/cutDV? (feed: player LOOP / CUT FEED rolls; 0/blank = action off),
  //                sceneId? (GM Go-to-Scene in the monitor view),
  //                ptz? + controlDV? (steerable camera head; controlDV gates TAKE CONTROL),
  //                looped?/loopedTime?/cut? (persisted by runCamAction — table state) }] }
  // STILLS: thumb grid — the FIRST flagged viewable frame becomes a 2×2 hero
  // (evidence-board focal point; no new authored field). FEED: every image is
  // a camera channel — label = CAM id, corrupted/cut = SIGNAL LOST, locked =
  // ENCRYPTED CHANNEL, looped = frozen frame + stale timestamp (the heist
  // tell). Clicking a viewable frame fires `galleryView` → the NCM lightbox
  // (feed = monitor skin with channel nav + the LOOP/CUT action rail).
  [CONTENT_TYPES.GALLERY]: (cd, _entry, ctx = {}) => {
    const gm = !!ctx.isGM;
    const isFeed = cd.mode === 'feed';
    // Clock source (feed only): 'game' = the time provider (synced with every
    // other NCM clock — Simple Calendar / world-time / manual / disguised all
    // move it) · 'real' = the wall clock, so cameras keep ticking when game
    // time is paused or manual · 'authored' = each cam's own diegetic `time`
    // string, frozen (recovered footage) · 'off' = no timestamps at all.
    const clock = ['game', 'real', 'authored', 'off'].includes(cd.clock) ? cd.clock : 'game';
    const clockLive = isFeed && (clock === 'game' || clock === 'real');
    let flaggedCount = 0, corruptedCount = 0, lockedCount = 0, loopedCount = 0;
    let heroDone = false;
    const images = (cd.images || []).map((img, i) => {
      const locked = !!img.locked;
      // OFFLINE = authored dead (`corrupted`) OR player-cut (`cut`, persisted).
      const offline = !!img.corrupted || !!img.cut;
      const looped = !!img.looped && !offline && !locked;
      if (img.flagged) flaggedCount++;
      if (offline) corruptedCount++;
      if (locked) lockedCount++;
      if (looped) loopedCount++;
      // Stills hero — first flagged frame that can actually show a picture.
      const isHero = !isFeed && cd.layout !== 'strip' && !heroDone && !!img.flagged
        && !locked && !offline && !!img.url;
      if (isHero) heroDone = true;
      const loopDV = Number(img.loopDV) || 0;
      const cutDV = Number(img.cutDV) || 0;
      return {
        ...img, idx: i,
        locked, offline, looped, cut: !!img.cut,
        // A locked frame must NOT render its <img> — the src would leak in
        // the DOM. It renders as an encrypted tile with a DECRYPT roll
        // (contentUnlock kind 'gallery'; per-image unlockSkill/unlockDV
        // beat the vault-level pair — effDV feeds the tooltip).
        hasImage: !!img.url && !offline && !locked,
        effDV: Number(img.unlockDV ?? cd.unlockDV) || 15,
        color: _colorName(img.color || (img.flagged ? 'amber' : 'muted')),
        label: img.label || (isFeed ? `CAM_${String(i + 1).padStart(2, '0')}` : `IMG_${String(i + 1).padStart(3, '0')}`),
        isHero,
        // Feed extras. `liveClock` cams carry data-feed-clock and are ticked by
        // refreshFeedClocks; a LOOPED cam never does — its frozen `loopedTime`
        // IS the heist tell (a live clock there would leak the loop). Under
        // clock 'authored' the cam shows its own diegetic `time` string.
        liveClock: clockLive && !offline && !locked && !looped,
        staticTime: (clock === 'authored' && !offline && !locked && !looped) ? (img.time || '') : '',
        staleTime: looped ? (img.loopedTime || img.time || '') : '',
        signal: Math.min(4, Math.max(1, Number(img.signal) || 4)),
        loopDV, cutDV,
        canLoop: isFeed && !locked && !offline && !looped && loopDV > 0,
        canCut: isFeed && !locked && !offline && cutDV > 0,
        canRestore: isFeed && !!gm && (looped || !!img.cut),
        hasScene: !!img.sceneId,
        ptz: !!img.ptz && !!img.url && !locked && !offline,
        controlDV: Number(img.controlDV) || 0,
      };
    });
    return {
      ...cd, images, count: images.length,
      flaggedCount, corruptedCount, lockedCount, loopedCount,
      unlockDV: cd.unlockDV || 15,
      camSkill: cd.camSkill || 'Electronics/Security Tech',
      isStrip: !isFeed && cd.layout === 'strip',
      isFeed,
      clock, clockLive,
      feedClock: clockLive ? _feedClockLabel(clock) : '',
      // Filter chips (stills toolbar) only render when there's something to solo.
      showFilters: !isFeed && (flaggedCount > 0 || lockedCount > 0),
    };
  },

  // DOCUMENT — memo/report viewer. Authored shape:
  //   { title?, docType? ('MEMO'|'REPORT'|…), author?, org?, date?, revision?,
  //     classification?, watermark?, signed?,
  //     declassify? + declassifySkill?/declassifyDV? (one roll lifts ALL bars),
  //     paragraphs: [{ heading?, text?, redacted?, quote? }] }
  //   Redacted paragraphs need `text` — that's what DECLASSIFY reveals.
  // Classification tints the stamp (RESTRICTED amber / SECRET+ red); watermark
  // renders as a repeated ghost via a data-watermark attr; redacted paragraphs
  // become bars. Plain-text authored content — no HTML injection surface.
  [CONTENT_TYPES.DOCUMENT]: (cd) => {
    const cls = String(cd.classification || '').toUpperCase();
    const classColor = /SECRET|EYES ONLY|BLACK/.test(cls) ? 'red' : (cls ? 'amber' : '');
    // Body blocks: text/quote (heading + inline-HTML text), list (ordered? +
    // items[]), figure (image + caption → lightbox). Legacy paragraphs (no kind)
    // read as text. `text` is inline HTML (b/i/u) → rendered raw in the partial.
    const paragraphs = (cd.paragraphs || []).map(p => {
      const kind = (p.kind === 'list' || p.kind === 'figure') ? p.kind : 'text';
      if (kind === 'list') {
        const items = (Array.isArray(p.items) ? p.items : String(p.items || '').split('\n')).map(s => String(s).trim()).filter(Boolean);
        return { isList: true, ordered: !!p.ordered, items, heading: p.heading || '', hasItems: items.length > 0 };
      }
      if (kind === 'figure') {
        return { isFigure: true, image: p.image || '', caption: p.caption || '', heading: p.heading || '', hasImage: !!p.image };
      }
      return {
        isText: true, heading: p.heading || '', text: p.text || '',
        redacted: !!p.redacted, quote: !!p.quote,
        declassified: !!p.declassified, // revealed by a DECLASSIFY roll — green tint
      };
    });
    // Dated line: an ISO date (from the CyberTimePicker) formats to the world's
    // date style; a legacy free-text date shows as-is.
    let dateLabel = cd.date || '';
    if (dateLabel && /^\d{4}-\d{2}-\d{2}/.test(dateLabel)) {
      try { dateLabel = formatCyberDate(new Date(dateLabel).toISOString(), { dateOnly: true }); } catch { /* keep raw */ }
    }
    return {
      ...cd, paragraphs, dateLabel,
      docType: (cd.docType || 'DOCUMENT').toUpperCase(),
      classification: cls, classColor,
      hasMeta: !!(cd.author || cd.org || cd.date || cd.revision),
      signedImage: cd.signedImage || '',        // a signature image beats the text line
      redactedCount: paragraphs.filter(p => p.redacted).length,
      // DECLASSIFY affordance (contentUnlock kind 'document') — GM arms it via
      // `declassify: true` + declassifySkill/declassifyDV.
      canDeclassify: !!cd.declassify && paragraphs.some(p => p.redacted),
      declassifyDV: cd.declassifyDV || 15,
    };
  },

  // CHATLOG — IM-app transcript (redesign 2026-07-12: dates, kinds, reactions).
  // Authored shape:
  //   { channel?, app?, participants?: [{ name, color?, me? }],
  //     messages: [{ from, text, time?, date?, deleted?, reactions?: [emoji],
  //       seen?, kind?: 'photo'|'system', image?, caption?, system?, sysIcon? }] }
  // `time` stays a free diegetic string; `date` (ISO) drives day grouping — a
  // date-separator is emitted whenever the day changes. kind 'photo' renders a
  // photo bubble (→ lightbox), 'system' a centered notice (no sender). The `me`
  // participant's bubbles sit right; reactions aggregate to {emoji,count};
  // `seen` closes an owner run with a Seen receipt.
  [CONTENT_TYPES.CHATLOG]: (cd) => {
    const palette = CT_COLORS.filter(c => c !== 'muted');
    const people = {};
    (cd.participants || []).forEach((p, i) => {
      people[p.name] = { name: p.name, color: _colorName(p.color || palette[i % palette.length]), me: !!p.me };
    });
    let next = Object.keys(people).length;
    let prevDate = null, prevFrom = null, prevSystem = false;
    const messages = (cd.messages || []).map((m) => {
      const kind = (m.kind === 'photo' || m.kind === 'system') ? m.kind : 'text';
      // Day separator when the message's date differs from the running day.
      let daySep = '';
      if (m.date && m.date !== prevDate) {
        try { daySep = formatCyberDate(new Date(m.date).toISOString(), { dateOnly: true }); } catch { daySep = String(m.date); }
      }
      if (m.date) prevDate = m.date;

      if (kind === 'system') {
        prevFrom = null; prevSystem = true;
        return { isSystem: true, daySep, system: m.system || m.text || '', sysIcon: m.sysIcon || 'circle-info', time: m.time || '' };
      }
      if (!people[m.from]) { people[m.from] = { name: m.from, color: palette[next % palette.length], me: false }; next++; }
      const p = people[m.from];
      const showName = !p.me && (m.from !== prevFrom || !!daySep || prevSystem);
      // Reactions: array of emoji → aggregated [{emoji,count}].
      const rmap = {};
      (Array.isArray(m.reactions) ? m.reactions : []).forEach(e => { if (e) rmap[e] = (rmap[e] || 0) + 1; });
      const reactions = Object.entries(rmap).map(([emoji, count]) => ({ emoji, count, many: count > 1 }));
      prevFrom = m.from; prevSystem = false;
      return {
        ...m, kind, daySep, color: p.color, me: p.me, showName,
        isPhoto: kind === 'photo', isText: kind === 'text',
        image: m.image || '', caption: m.caption || '',
        reactions, hasReactions: reactions.length > 0,
        seen: !!m.seen, seenTime: m.seenTime || m.time || '',
      };
    });
    const participants = Object.values(people);
    return {
      ...cd, messages, participants,
      app: cd.app || 'BabelChat',
      channel: cd.channel || '',
      msgCount: messages.filter(m => !m.isSystem).length,
    };
  },

  // RECORD — searchable subject database (§8c "look someone up → intel";
  // typed-field redesign 2026-07-12). Authored shape:
  //   { dbName?, recordType? (a RECORD_DB_KINDS key, drives the header + new-card
  //     seed), searchable? (default true),
  //     records: [{ id?, name, status?, statusColor?, flagged?, portrait?,
  //       fields: [{ kind (RECORD_FIELD_KINDS key), value, label? (custom only) }] }] }
  // Each record → portrait/initials, idLabel (an `id`-kind field or top-level id),
  // status pill, and a normalized display-field list (icon/label + threat meter /
  // rating stars / flag chip / evidence thumb / date label / note). Legacy records
  // (flat role/org/address/note) migrate to synthetic fields. Search index covers
  // every value (the client-side [data-db-search] filter below).
  [CONTENT_TYPES.RECORD]: (cd) => {
    let flaggedCount = 0;
    const records = (cd.records || []).map((r, i) => {
      if (r.flagged) flaggedCount++;
      const name = r.name || `RECORD ${i + 1}`;

      // Resolve the record's field list — authored `fields[]`, else migrate the
      // legacy flat keys into synthetic fields (preserving order).
      let rawFields = Array.isArray(r.fields) ? r.fields.slice() : [];
      if (!rawFields.length) {
        for (const [key, kind] of Object.entries(RECORD_LEGACY_MAP)) {
          if (r[key]) rawFields.push({ kind, value: r[key] });
        }
      }

      // idLabel: an explicit id-kind field wins, else top-level id, else #NNNN.
      // The id field is pulled OUT of the row list (it renders by the name).
      let idLabel = r.id || '';
      const displayFields = [];
      const searchBits = [name, r.status, r.id];
      for (const f of rawFields) {
        if (!f || !f.kind) continue;
        const info = RECORD_FIELD_KINDS[f.kind];
        if (!info) continue;
        const val = f.value;
        searchBits.push(f.label, typeof val === 'string' ? val : '');
        if (f.kind === 'id' && !idLabel && val) { idLabel = String(val); continue; }
        const df = {
          kind: f.kind, icon: info.icon, label: f.label || info.label, full: !!info.full,
          type: info.type, value: val,
        };
        if (info.type === 'threat') { df.isThreat = true; df.meterClass = `t${Math.max(1, Math.min(4, Number(val) || 1))}`; }
        else if (info.type === 'rating') { df.isRating = true; df.ratingN = Math.max(0, Math.min(5, Number(val) || 0)); df.stars = [1, 2, 3, 4, 5].map(n => ({ on: n <= df.ratingN })); }
        else if (info.type === 'flag') { if (!val) continue; df.isFlag = true; }         // a false flag is noise
        else if (info.type === 'image') { if (!val) continue; df.isImage = true; df.src = String(val); df.full = true; }
        else if (info.type === 'number') { if (val === '' || val == null) continue; df.isNumber = true; df.display = `${Number(val).toLocaleString()}${info.unit ? ' ' + info.unit : ''}`; }
        else if (info.type === 'textarea') { if (!val) continue; df.isNote = true; }
        else if (info.type === 'date') { if (!val) continue; df.isDate = true; try { df.display = formatCyberDate(new Date(val).toISOString(), { dateOnly: true }); } catch { df.display = String(val); } }
        else { if (!val) continue; df.display = String(val); }
        displayFields.push(df);
      }

      return {
        id: r.id, name, portrait: r.portrait || '', flagged: !!r.flagged, status: r.status || '',
        idLabel: idLabel || `#${String(i + 1).padStart(4, '0')}`,
        initials: name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(),
        statusColor: _colorName(r.statusColor || STATUS_COLOR[String(r.status || '').toUpperCase()] || 'muted'),
        fields: displayFields,
        searchText: searchBits.filter(Boolean).join(' ').toLowerCase(),
      };
    });
    return {
      ...cd, records, count: records.length, flaggedCount,
      dbName: cd.dbName || 'RECORDS',
      recordType: (RECORD_DB_KINDS[cd.recordType]?.label) || cd.recordType || '',
      searchable: cd.searchable !== false,
    };
  },

  // SCHEMATIC — annotated floorplan/blueprint (§8c heist intel). Authored:
  //   { title?, imageUrl, docRef?, linkedSceneId?,
  //     annotations: [{ x, y (0–100 %), label, note?, color? }] }
  // Pins are numbered and positioned over the image (percent coords survive
  // any render size); the image click reuses the gallery lightbox; a linked
  // scene shows the GM "Go to Scene" button (LOCATION precedent).
  // SCHEMATIC — annotated heist blueprint (redesign 2026-07-12). Authored:
  //   { title?, imageUrl, docRef?, linkedSceneId?,
  //     annotations: [{ id?, x, y (0–100%), type? (SCHEM_MARKERS key), label?,
  //       note?, color?, sceneId?, locked?, unlockSkill?, unlockDV? }],
  //     routes: [{ from: pinId, to: pinId, color? }] }
  // Pins render as their marker-type icon; `locked` fogs a pin ('?') for players
  // until a scout roll reveals it (contentUnlock kind 'schematic'). Routes draw
  // an infil path between pins. Legend groups by marker category.
  [CONTENT_TYPES.SCHEMATIC]: (cd, entry, ctx = {}) => {
    const isGM = !!ctx.isGM;
    const clamp = (v) => Math.max(0, Math.min(100, Number(v) || 0));
    const byId = {};
    const annotations = (cd.annotations || []).map((a, i) => {
      const id = a.id || `s${i}`;
      const info = schemMarkerInfo(a.type);
      const fog = !!a.locked && !isGM;              // players see a fog '?'
      const x = clamp(a.x), y = clamp(a.y);
      byId[id] = { x, y };
      return {
        id, n: i + 1, idx: i, x, y,
        type: a.type || 'pin',
        icon: fog ? 'fas fa-question' : info.icon,
        color: fog ? 'muted' : _colorName(a.color || info.color),
        markerLabel: info.label,
        group: info.group,
        label: fog ? '' : (a.label || info.label),
        note: fog ? '' : (a.note || ''),
        sceneId: fog ? '' : (a.sceneId || ''),
        hasScene: !fog && !!a.sceneId,
        isFog: fog,
        locked: !!a.locked,
        effDV: Number(a.unlockDV) || 15,
      };
    });
    // Routes → resolved endpoint coords (skip any whose pins are gone).
    const routes = (cd.routes || []).map(r => {
      const a = byId[r.from], b = byId[r.to];
      if (!a || !b) return null;
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: _colorName(r.color || 'cyan') };
    }).filter(Boolean);
    // Legend grouped by marker category (ordered; fog pins → a Locked group).
    const groups = {};
    for (const a of annotations) {
      const g = a.isFog ? 'Locked' : a.group;
      (groups[g] ||= []).push(a);
    }
    const legendGroups = [...SCHEM_GROUP_ORDER, 'Locked']
      .filter(g => groups[g]?.length)
      .map(g => ({ name: g, pins: groups[g] }));
    return {
      ...cd, annotations, routes, legendGroups,
      title: cd.title || 'SCHEMATIC',
      hasImage: !!cd.imageUrl,
      hasRoutes: routes.length > 0,
      pinCount: annotations.length,
    };
  },

  // NOTE — a sticky note (§8c: "sometimes the actual solution"). Authored:
  //   { text, title?, color?, pinned? }. Deliberately trivial — plain text,
  //   pre-wrap line breaks, one authorable paper color.
  [CONTENT_TYPES.NOTE]: (cd) => ({
    ...cd,
    text: cd.text || '',
    color: _colorName(cd.color || 'gold'),
    pinned: !!cd.pinned,
  }),

  // MALWARE — a quarantined executable (§8c: "copyable weapon; honeypot
  // variant trips a trace"). Authored:
  //   { name, payloadType? ('virus'|'worm'|'daemon'|'logic bomb'|…),
  //     description?, threat? (1–4 meter), sizeLabel?, deployable?, deployed?,
  //     deployedBy?, tripped?, honeypot?, traceDV?,
  //     deployRequire?, deploySkill?, deployDV? (optional roll to run it clean),
  //     iceActorId? (linked Black ICE actor — attacks the operator on a misfire) }
  // `honeypot` renders a GM-only tag (the template gates on isGM); deploying
  // one fires the trace instead of the payload (SiphonFlow.runMalwareDeploy).
  [CONTENT_TYPES.MALWARE]: (cd) => ({
    ...cd,
    name: cd.name || 'UNKNOWN.exe',
    typeLabel: String(cd.payloadType || 'unknown').toUpperCase(),
    threatClass: cd.threat ? `t${Math.max(1, Math.min(4, cd.threat))}` : '',
    canDeploy: !!cd.deployable && !cd.deployed,
    deployed: !!cd.deployed,
    tripped: !!cd.tripped,
    deployedByName: cd.deployedBy ? (game.actors?.get(cd.deployedBy)?.name ?? 'Unknown') : '',
    // GM-only chip: the linked Black ICE that bites the operator on a misfire
    // (players find out the hard way, like the honeypot tag). The ICE actor's
    // portrait replaces the biohazard file icon for EVERYONE — flavor art,
    // not a tell (dev-requested touch).
    iceName: cd.iceActorId ? (game.actors?.get(cd.iceActorId)?.name ?? 'BLACK ICE') : '',
    iceImg: cd.iceActorId ? (game.actors?.get(cd.iceActorId)?.img ?? null) : null,
  }),
};

/** Capitalize a content-type value for the `is<Type>` flag name (avlog → Avlog). */
function _flagName(typeValue) {
  return 'is' + typeValue.charAt(0).toUpperCase() + typeValue.slice(1);
}

/**
 * Turn a raw typed entry into the view-model rendered by content-body.hbs.
 *
 * @param {object} entry  Raw entry: { contentType, contentData, subject, from, body, timestamp, encrypted, decrypted, corrupted, ... }
 * @param {object} [ctx]  { isGM?:boolean, interactive?:boolean } — `interactive`
 *                        (default true) gates action buttons (claim/execute/
 *                        goToScene); read-only consumers (e.g. a future terminal
 *                        download view) pass false.
 * @returns {object} enriched view-model with typeInfo fields, is<Type> flags,
 *                   processed contentData, and isGM/interactive/isLocked.
 */
export function enrichContent(entry, ctx = {}) {
  // ── PAYLOAD disguise passthrough ──
  // A disguised, un-sniffed, not-yet-executed payload renders as its COVER type
  // for players — truly innocuous (the real payload data never reaches their
  // DOM). The GM always sees the real payload (with a red disguise tag), so
  // they can audit. Resolved here, before type dispatch, by swapping the entry.
  if (entry.contentType === CONTENT_TYPES.PAYLOAD) {
    const cd = entry.contentData || {};
    const hideFromViewer = cd.disguised && !cd.sniffed && !cd.executed && !ctx.isGM;
    if (hideFromViewer) {
      const coverType = cd.disguiseType || CONTENT_TYPES.NOTE;
      const cover = enrichContent({
        ...entry,
        contentType: coverType,
        contentData: _disguiseCover(coverType, cd),
        subject: cd.name || entry.subject,
        body: coverType === CONTENT_TYPES.MESSAGE ? (cd.description || entry.body) : entry.body,
      }, ctx);
      cover._disguisedPayload = true; // internal marker (never templated)
      return cover;
    }
  }

  const type = entry.contentType || CONTENT_TYPES.MESSAGE;
  const typeInfo = getContentTypeInfo(type);

  const enriched = {
    ...entry,
    formattedDate: entry.timestamp ? formatCyberDate(entry.timestamp) : 'UNKNOWN',
    contentTypeLabel: typeInfo.label,
    entryIcon: typeInfo.icon,
    accentColor: typeInfo.accent,
    isLocked: !!(entry.encrypted && !entry.decrypted),
    isGM: ctx.isGM ?? false,
    interactive: ctx.interactive !== false,
  };

  // is<Type> flags for every known type (MESSAGE also true when type is unset).
  for (const value of Object.values(CONTENT_TYPES)) {
    enriched[_flagName(value)] = type === value;
  }
  if (!entry.contentType) enriched.isMessage = true;

  // Per-type contentData processing.
  const enrich = ENRICHERS[type];
  if (enrich && entry.contentData) enriched.contentData = enrich(entry.contentData, entry, ctx);

  return enriched;
}

// ═══════════════════════════════════════════════════════════
//  Client-side content interactions (pure DOM — no persistence)
//  Registered as data-actions in BOTH viewers; both delegate here.
// ═══════════════════════════════════════════════════════════

/** Toggle a credentials row's secret between the masked dots and plain text. */
export function toggleSecretReveal(target) {
  const pair = target.closest('.ncm-ct-creds__pair');
  if (!pair) return;
  const revealed = pair.classList.toggle('is-revealed');
  const icon = target.matches('i') ? target : target.querySelector('i');
  icon?.classList.toggle('fa-eye', !revealed);
  icon?.classList.toggle('fa-eye-slash', revealed);
  target.setAttribute('data-tooltip', revealed ? 'Hide the key' : 'Show the key');
}

/**
 * Filter a syslog feed by severity via its legend chips — click a severity to
 * solo it, click it again (or ALL) to show everything. Display-only.
 */
export function applySyslogFilter(target) {
  const box = target.closest('.ncm-ct-log');
  const sev = target.dataset.sev;
  if (!box || !sev) return;
  const active = (sev === 'all' || target.classList.contains('is-on')) ? 'all' : sev;
  box.querySelectorAll('.ncm-ct-log__fp').forEach(c => c.classList.toggle('is-on', c.dataset.sev === active));
  box.querySelectorAll('.ncm-ct-log__line').forEach(l => {
    l.classList.toggle('is-hidden', active !== 'all' && !l.classList.contains(`ncm-ct-log__line--${active}`));
  });
}

/**
 * RECORD search — display-only filtering of database record rows by the
 * [data-db-search] input. Wired ONCE at module load as a document-level
 * delegated `input` listener (typing isn't a data-action click, and a
 * document listener works identically in all three viewers AND the composer
 * live preview with zero per-app wiring — the BaseApplication document-capture
 * precedent). Guarded for non-DOM contexts so node logic sims can import this
 * module.
 */
let _dbSearchWired = false;
(function _wireDbSearchOnce() {
  if (_dbSearchWired || typeof document === 'undefined') return;
  _dbSearchWired = true;
  document.addEventListener('input', (e) => {
    const input = e.target;
    if (!input?.matches?.('[data-db-search]')) return;
    const box = input.closest('.ncm-ct-db');
    if (!box) return;
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    box.querySelectorAll('.ncm-ct-db__rec').forEach(r => {
      const hit = !q || (r.dataset.search || '').includes(q);
      r.classList.toggle('is-hidden', !hit);
      if (hit) shown++;
    });
    box.querySelector('.ncm-ct-db__nohit')?.classList.toggle('is-on', shown === 0);
  }, true);
})();

/**
 * CALENDAR view state — display-only interactions (no persistence): the
 * TIMELINE/MONTH toggle, the SHOW PAST collapse, month ‹ › nav, and pip-jump
 * (month pip → timeline scrolled to that event). Wired ONCE as a document-level
 * delegated capture click on [data-cal-act] (the record-search precedent — one
 * listener serves all three viewers AND the composer live preview; NOT a
 * data-action, so it never collides with the apps' AppV2 action maps).
 * Guarded for non-DOM contexts so node logic sims can import this module.
 */
let _calActWired = false;
(function _wireCalActOnce() {
  if (_calActWired || typeof document === 'undefined') return;
  _calActWired = true;
  const setView = (box, view) => {
    box.dataset.calView = view;
    box.querySelectorAll('[data-cal-act="view"]').forEach(b => b.classList.toggle('is-on', b.dataset.view === view));
  };
  document.addEventListener('click', (e) => {
    const t = e.target?.closest?.('[data-cal-act]');
    if (!t) return;
    const box = t.closest('.ncm-ct-cal');
    if (!box) return;
    const act = t.dataset.calAct;
    if (act === 'view') {
      setView(box, t.dataset.view === 'month' ? 'month' : 'rail');
    } else if (act === 'past') {
      t.classList.toggle('is-open', box.classList.toggle('is-past-open'));
    } else if (act === 'nav') {
      const months = [...box.querySelectorAll('.ncm-ct-cal__month')];
      const cur = Math.max(0, months.findIndex(mo => mo.classList.contains('is-on')));
      const next = cur + (t.dataset.dir === 'next' ? 1 : -1);
      if (next < 0 || next >= months.length) return;
      months.forEach((mo, i) => mo.classList.toggle('is-on', i === next));
    } else if (act === 'jump') {
      setView(box, 'rail');
      const ev = box.querySelector(`[data-cal-ev="${t.dataset.evIdx}"]`);
      if (ev?.closest('.ncm-ct-cal__pastwrap')) {
        box.classList.add('is-past-open');
        box.querySelector('[data-cal-act="past"]')?.classList.add('is-open');
      }
      ev?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      ev?.classList.add('is-jumped');
      setTimeout(() => ev?.classList.remove('is-jumped'), 1600);
    }
  }, true);
})();

/**
 * CALENDAR live clock — re-derives every open calendar's countdown labels,
 * urgency-bar fills, soon/past dimming, the NEXT strip, and the month grid's
 * "today" ring from the time provider (so Simple Calendar / world-time /
 * manual advances all move it). Pure DOM patching keyed on the data-ts each
 * READABLE event carries (fogged events deliberately have none — their date
 * is withheld). Structural changes (an event re-filing under SHOW PAST, the
 * NEXT strip picking a new event) still wait for the next render — the strip
 * hides itself once its event passes so it can't show a stale "next".
 * Driven by a 1s interval (the MessageViewer HUD-clock pattern; ~free when no
 * calendar is on screen) + Foundry's updateWorldTime hook so Simple Calendar
 * jumps land instantly.
 */
export function refreshCalendarClocks() {
  if (typeof document === 'undefined') return;
  const boxes = document.querySelectorAll('.ncm-ct-cal');
  if (!boxes.length) return;
  const now = _nowMs();
  const soonWin = 3 * 86400000;
  const today = new Date(now);
  const [ty, tm, td] = [today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()];
  for (const box of boxes) {
    for (const ev of box.querySelectorAll('.ncm-ct-cal__ev[data-ts]')) {
      const t = Number(ev.dataset.ts);
      if (!t) continue;
      const diff = t - now;
      const when = ev.querySelector('.ncm-ct-cal__when');
      if (when) when.textContent = _relCal(diff);
      const past = diff < 0;
      const soon = !past && diff < soonWin;
      ev.classList.toggle('is-past', past);
      ev.classList.toggle('is-soon', soon);
      const urg = ev.querySelector('.ncm-ct-cal__urg i');
      if (urg) urg.style.width = soon ? `${Math.max(10, Math.min(100, Math.round(100 - (diff / soonWin) * 100)))}%` : '0%';
    }
    const next = box.querySelector('.ncm-ct-cal__next[data-ts]');
    if (next) {
      const diff = Number(next.dataset.ts) - now;
      const count = next.querySelector('.ncm-ct-cal__next-count b');
      if (count) count.textContent = _relCal(diff);
      next.classList.toggle('is-over', diff < 0);
    }
    // Month grid: move the "today" ring when the day flips (Simple Calendar jumps).
    for (const mo of box.querySelectorAll('.ncm-ct-cal__month[data-ym]')) {
      const isMonth = mo.dataset.ym === `${ty}-${tm}`;
      for (const cell of mo.querySelectorAll('.ncm-ct-cal__daycell')) {
        cell.classList.toggle('is-today',
          isMonth && !cell.classList.contains('is-out') && Number(cell.dataset.d) === td);
      }
    }
  }
}
/**
 * CAMERA-FEED live clocks — every [data-feed-clock] (multiplex header, per-cam
 * timestamps, the monitor view's REC clock) re-reads its clock source. The
 * attribute's VALUE is the mode ('game' = the time provider, in sync with every
 * other NCM clock; 'real' = the wall clock, for worlds whose game clock is
 * paused/manual), so one page can hold both kinds of feed. Looped cams
 * deliberately carry NO data-feed-clock — their frozen stale time IS the heist
 * tell, and a live clock there would leak the loop. Rides the same 1s interval
 * + updateWorldTime hook as the calendar ticker, so Simple Calendar advances
 * move the whole wall.
 */
export function refreshFeedClocks() {
  if (typeof document === 'undefined') return;
  const els = document.querySelectorAll('[data-feed-clock]');
  if (!els.length) return;
  const cache = {};
  for (const el of els) {
    const mode = el.dataset.feedClock === 'real' ? 'real' : 'game';
    cache[mode] ??= _feedClockLabel(mode);
    el.textContent = cache[mode];
  }
}

let _calTickWired = false;
(function _wireCalTickOnce() {
  if (_calTickWired || typeof document === 'undefined') return;
  _calTickWired = true;
  const tick = () => { refreshCalendarClocks(); refreshFeedClocks(); };
  setInterval(tick, 1000);
  if (typeof Hooks !== 'undefined') Hooks.on?.('updateWorldTime', tick);
})();

/**
 * GALLERY stills filter chips — solo the flagged / encrypted frames (the
 * syslog-filter model). Display-only: the handler stamps data-gal-filter on
 * the gallery box and CSS hides non-matching cells. Document-delegated on
 * [data-gal-act] (the [data-cal-act] precedent — all three viewers + the
 * composer preview, zero per-app wiring).
 *
 * NOTE — the MAIL/FILES chips (terminal sidebar + Agent inbox) deliberately do
 * NOT use this driver. They live in apps that re-render on every click, so a
 * display-only filter reset itself the moment you opened a message. They're
 * real `data-action`s backed by app state (`_envFilter`) instead. Gallery chips
 * stay display-only because a gallery re-render is scoped to its own entry.
 */
let _galActWired = false;
(function _wireGalActOnce() {
  if (_galActWired || typeof document === 'undefined') return;
  _galActWired = true;
  document.addEventListener('click', (e) => {
    const t = e.target?.closest?.('[data-gal-act]');
    if (!t || t.dataset.galAct !== 'filter') return;
    const box = t.closest('[data-gal-box]');
    if (!box) return;
    // Clicking the active solo chip returns to ALL.
    const f = (t.classList.contains('is-on') && t.dataset.f !== 'all') ? 'all' : (t.dataset.f || 'all');
    box.dataset.galFilter = f;
    box.querySelectorAll('[data-gal-act="filter"]').forEach(b => b.classList.toggle('is-on', b.dataset.f === f));
  }, true);
})();

/**
 * EDDIES CLAIM TRANSFER (#eddies redesign, 2026-07-14) — the "cred drain +
 * secure-handshake stamp" animation: the amount drains off the chip while a
 * green ledger line counts up, over a short AUTHORIZING → TRANSFER → ✓ FUNDS
 * RELEASED sequence; the card holds GOLD until the count finishes, then flips
 * green.
 *
 * Wired ONCE as a document-level `animationstart` listener (the freshly-claimed
 * card carries `.is-fresh` → the trivial `ncm-ct-eddies-arm` keyframe → this
 * fires). This is the zero-per-app-wiring pattern the other content actions use,
 * and animationstart mounts exactly when a fresh card appears in ANY viewer.
 *
 * The card re-renders on every click for the ~12s `justClaimed` window, so the
 * arm keyframe fires every time — `_eddiesAnimated` (keyed on the entry id)
 * guards so the count plays ONCE per claim and later re-renders snap to the end
 * state. Reduced motion jumps straight to the end. Real-time rAF is deliberate
 * (UI animation, not game time).
 */
const _eddiesAnimated = new Set();   // completed — later sightings snap to end
const _eddiesAnimating = new Set();  // in-flight — a re-render re-arm must not restart it
let _eddiesAnimWired = false;
(function _wireEddiesAnimOnce() {
  if (_eddiesAnimWired || typeof document === 'undefined') return;
  _eddiesAnimWired = true;
  document.addEventListener('animationstart', (e) => {
    if (e.animationName !== 'ncm-ct-eddies-arm') return;
    const card = e.target;
    if (card?.classList?.contains?.('ncm-ct-eddies')) playEddiesTransfer(card);
  }, true);
})();

/**
 * Drive the cred-drain transfer on a freshly-claimed eddies card.
 *
 * THE TRAP this is built around: the viewer re-renders SEVERAL times during a
 * single claim (the persist-hook `_debouncedRender`, plus the handler's own
 * `render()`), and each render REPLACES the card element with a fresh one drawn
 * in its green END state (the template's robust default). So the animation is
 * built as ONE frame-driven loop that, every frame, resolves the LIVE card by
 * entry id and REPAINTS the entire state (class + status + amount + deposit)
 * for the current elapsed time. A remount at ANY phase self-corrects within one
 * frame — no captured element to orphan, and no "green flash" while the loop
 * happens to be idling in a between-beat wait. Plus a two-Set guard
 * (`_eddiesAnimating` in-flight vs `_eddiesAnimated` done) so a re-render's
 * re-arm never starts a SECOND loop, and only a genuine sighting AFTER
 * completion snaps to the end.
 */
function playEddiesTransfer(card) {
  const id = card.dataset.eddiesId || '';
  const total = Number(card.dataset.eddiesAmount) || 0;
  const fmt = (v) => v.toLocaleString();
  // Follow the id — never hold an element reference across a render.
  const liveCard = () => (id ? document.querySelector(`.ncm-ct-eddies[data-eddies-id="${id}"]`) : card) || card;
  // Paint the FULL state onto whatever card is currently mounted. `gold` holds
  // the transfer look; false lets the green claimed styling (:not(.is-transferring)) show.
  const paint = (amt, dep, status, gold) => {
    const c = liveCard(); if (!c) return;
    c.classList.toggle('is-transferring', gold);
    const a = c.querySelector('[data-eddies-amt]'); if (a) a.innerHTML = `${fmt(amt)}<span class="ncm-ct-eddies__eb">eb</span>`;
    const d = c.querySelector('[data-eddies-dep]'); if (d) d.textContent = fmt(dep);
    const s = c.querySelector('[data-eddies-status]'); if (s) s.textContent = status;
  };
  const end = () => paint(total, total, '✓ FUNDS RELEASED', false);
  const done = () => { if (id) { _eddiesAnimating.delete(id); _eddiesAnimated.add(id); } };

  // Already finished → snap to end. Already running → this trigger is a
  // re-render's re-arm; the in-flight loop follows the id, so leave it alone.
  if (id && _eddiesAnimated.has(id)) { end(); return; }
  if (id && _eddiesAnimating.has(id)) return;
  if (id) _eddiesAnimating.add(id);

  let reduced = false;
  try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { /* no matchMedia */ }
  if (reduced) { end(); done(); return; }

  // Beat durations (ms) — tuned deliberately SLOW so the transfer reads as a
  // real transaction, not a flash. Bump these to taste.
  const T_AUTH = 900;    // ◈ AUTHORIZING… hold
  const T_HAND = 700;    // ◈ ENCRYPTED HANDSHAKE hold
  const T_COUNT = 2200;  // ◈ TRANSFER — the drain/count
  const T_SETTLE = 350;  // drained beat before the released stamp lands
  const tHand = T_AUTH, tCount = T_AUTH + T_HAND, tSettle = tCount + T_COUNT, tEnd = tSettle + T_SETTLE;

  // ONE time-based loop: derive the whole card state from elapsed time and paint
  // it every frame, so any mid-animation remount is corrected on the next frame.
  let t0 = null;
  const frame = (t) => {
    if (t0 == null) t0 = t;
    const e = t - t0;
    if (e < tHand)        paint(total, 0, '◈ AUTHORIZING…', true);
    else if (e < tCount)  paint(total, 0, '◈ ENCRYPTED HANDSHAKE', true);
    else if (e < tSettle) {
      // steady quadratic ease-out so the number ticks the whole way rather than
      // dumping fast then crawling.
      const p = 1 - Math.pow(1 - (e - tCount) / T_COUNT, 2);
      paint(Math.round(total * (1 - p)), Math.round(total * p), '◈ TRANSFER', true);
    } else if (e < tEnd)  paint(0, total, '◈ TRANSFER', true);   // drained, still gold
    else { end(); done(); return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/**
 * AVLOG transcript playback (karaoke) — display-only: pressing ▶ on a deck
 * with no real media "plays" the transcript across its authored duration.
 * The waveform animates, the timecode ticks, played lines dim and the current
 * line glows (per-line start seconds ride `data-av-t`, total on `data-av-dur`).
 * Wired ONCE as a document-level delegated capture click on [data-av-act]
 * (the [data-cal-act] precedent — works in all three viewers + the composer
 * preview with zero per-app wiring). Real-time setInterval is deliberate —
 * this is UI animation, not game time. Reduced-motion jumps straight to the
 * end (all lines readable). Guarded for non-DOM contexts (node sims).
 */
let _avActWired = false;
(function _wireAvPlaybackOnce() {
  if (_avActWired || typeof document === 'undefined') return;
  _avActWired = true;
  const timers = new WeakMap();
  const fmtClock = (s) => {
    s = Math.max(0, Math.floor(s));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const setBtn = (box, icon) => {
    const b = box.querySelector('[data-av-act="toggle"] i');
    if (b) b.className = `fas fa-${icon}`;
  };
  const paint = (box, t, dur) => {
    const time = box.querySelector('[data-av-time]');
    if (time) time.textContent = fmtClock(t);
    const fill = box.querySelector('[data-av-fill]');
    if (fill) fill.style.width = `${Math.min(100, (t / dur) * 100)}%`;
    const bars = box.querySelectorAll('.ncm-ct-av__wave b');
    const played = Math.floor((t / dur) * bars.length);
    bars.forEach((bar, i) => bar.classList.toggle('is-past', i < played));
    const lines = [...box.querySelectorAll('.ncm-ct-av__line[data-av-t]')];
    let current = null;
    lines.forEach((ln, i) => {
      const start = Number(ln.dataset.avT) || 0;
      const next = i + 1 < lines.length ? (Number(lines[i + 1].dataset.avT) || dur) : dur;
      const done = t >= next, now = t >= start && t < next;
      ln.classList.toggle('is-done', done);
      ln.classList.toggle('is-now', now);
      ln.classList.toggle('is-next', t < start);
      if (now) current = ln;
    });
    current?.scrollIntoView?.({ block: 'nearest' });
  };
  const finish = (box) => {
    const st = timers.get(box);
    if (st?.iv) clearInterval(st.iv);
    timers.set(box, { t: 0, playing: false, iv: null });
    box.classList.remove('is-playing');
    // End state = fully readable transcript, ▶ re-arms a replay.
    box.querySelectorAll('.ncm-ct-av__line').forEach(ln => ln.classList.remove('is-done', 'is-now', 'is-next'));
    box.querySelectorAll('.ncm-ct-av__wave b').forEach(b => b.classList.add('is-past'));
    const fill = box.querySelector('[data-av-fill]');
    if (fill) fill.style.width = '100%';
    const time = box.querySelector('[data-av-time]');
    const dur = Number(box.dataset.avDur) || 0;
    if (time) time.textContent = fmtClock(dur);
    setBtn(box, 'rotate-left');
  };
  document.addEventListener('click', (e) => {
    const t = e.target?.closest?.('[data-av-act]');
    if (!t) return;
    const box = t.closest('.ncm-ct-av');
    const dur = Number(box?.dataset.avDur) || 0;
    if (!box || !dur) return;
    let st = timers.get(box) || { t: 0, playing: false, iv: null };
    if (st.playing) {
      // Pause.
      clearInterval(st.iv);
      st.playing = false; st.iv = null;
      timers.set(box, st);
      box.classList.remove('is-playing');
      setBtn(box, 'play');
      return;
    }
    // Reduced motion → no animation, land on the readable end state.
    let reduced = false;
    try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* no */ }
    if (reduced) { finish(box); return; }
    if (st.t >= dur) st.t = 0;
    st.playing = true;
    box.classList.add('is-playing');
    setBtn(box, 'pause');
    paint(box, st.t, dur);
    st.iv = setInterval(() => {
      st.t = Math.min(dur, st.t + 0.25);
      paint(box, st.t, dur);
      if (st.t >= dur) finish(box);
    }, 250);
    timers.set(box, st);
  }, true);
})();

/**
 * DOSSIER "open actor sheet" chip (GM convenience on the combat profile) —
 * a document-delegated capture click on [data-doss-sheet="<actorId>"], the
 * same zero-per-app-wiring pattern. The chip only renders for a GM.
 */
let _dossSheetWired = false;
(function _wireDossSheetOnce() {
  if (_dossSheetWired || typeof document === 'undefined') return;
  _dossSheetWired = true;
  document.addEventListener('click', (e) => {
    const t = e.target?.closest?.('[data-doss-sheet]');
    if (!t) return;
    game.actors?.get(t.dataset.dossSheet)?.sheet?.render(true);
  }, true);
})();

/**
 * Resolve an entry's From string against the GM Master List at read time —
 * the render-side half of "everything feeds through the master directory"
 * (the composer's save-side half creates the contact). Returns a sender
 * view-model for entry headers, or null for a blank From.
 *   { name, email ('' for system nodes), isNode, isDirectory,
 *     portrait|null (caller renders initials), initials, contactId, linkedActorId }
 */
export function resolveEntrySender(from) {
  const raw = String(from || '').trim();
  if (!raw) return null;
  const isEmail = raw.includes('@') && !raw.includes(' ');
  const ns = (typeof game !== 'undefined') ? game.nightcity : null;
  const contact = isEmail ? (ns?.masterContactService?.getByEmail?.(raw) ?? null) : null;
  const name = contact?.name || raw;
  const initials = name.split(/[\s._@-]+/).filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join('') || '?';
  return {
    name,
    email: isEmail ? raw : '',
    isNode: !isEmail,
    isDirectory: !!contact,
    portrait: contact ? (ns?.portraitService?.resolvePortrait?.(contact) ?? null) : null,
    initials,
    contactId: contact?.id || null,
    linkedActorId: contact?.actorId || null,
    // Send-only system address — callers must hide add/reply affordances.
    sendOnly: !!contact?.sendOnly,
  };
}

/** Minimal HTML escaper (node-sim safe — no Handlebars dependency). */
const _escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ═══════════════════════════════════════════════════════════
//  PTZ — steerable camera head (pan a huge image inside a clipped viewport).
//  Display-only state: pan/zoom memory + TAKE CONTROL grants live in
//  module-level maps keyed `${messageId}::${index}` so they survive the
//  constant AppV2 re-renders (the _ptzMem entry is this session's "where the
//  camera head is pointed"). Nothing persists — no GM relay needed to look
//  around. The patrol sweep is a rAF loop that self-stops when no PTZ
//  viewport is in the document (the calendar-interval discipline).
// ═══════════════════════════════════════════════════════════

const _ptzMem = new Map();      // key → { x, y, z, patrol, dir }
const _ptzGranted = new Set();  // TAKE CONTROL session grants (client-side)
let _ptzRafOn = false;

/** Reduced-motion probe (safe outside a DOM). */
function _reducedMotion() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
}

/** Whether this user may drive the PTZ head (GM always; DV 0 = free). */
export function ptzHasControl(messageId, index, controlDV) {
  const gm = (typeof game !== 'undefined') && !!game.user?.isGM;
  return gm || !(Number(controlDV) > 0) || _ptzGranted.has(`${messageId}::${index}`);
}

/**
 * Grant PTZ control after a won TAKE CONTROL roll (runCamAction 'control') —
 * client-side only, deliberately un-persisted (a re-login is a re-hijack).
 * Notifies an open lightbox so its stage swaps the patrol view for the pad.
 */
export function grantPtzControl(messageId, index) {
  _ptzGranted.add(`${messageId}::${index}`);
  try { document.dispatchEvent(new CustomEvent('ncm-ptz-granted', { detail: { messageId, index } })); } catch (_) { /* headless */ }
}

/** Build the PTZ stage markup (monitor view). Pad renders only with control. */
function _ptzStageHtml({ key, src, alt, hasControl }) {
  const pad = hasControl ? `
      <div class="ncm-ptz__zoom">
        <button type="button" data-ptz-act="zoom" data-dz="1" data-tooltip="Zoom in">+</button>
        <button type="button" data-ptz-act="zoom" data-dz="-1" data-tooltip="Zoom out">−</button>
      </div>
      <div class="ncm-ptz__pad">
        <span></span><button type="button" data-ptz-act="pan" data-dx="0" data-dy="-1"><i class="fas fa-chevron-up"></i></button><span></span>
        <button type="button" data-ptz-act="pan" data-dx="-1" data-dy="0"><i class="fas fa-chevron-left"></i></button>
        <button type="button" data-ptz-act="home" data-tooltip="Recenter">⌂</button>
        <button type="button" data-ptz-act="pan" data-dx="1" data-dy="0"><i class="fas fa-chevron-right"></i></button>
        <span></span><button type="button" data-ptz-act="pan" data-dx="0" data-dy="1"><i class="fas fa-chevron-down"></i></button><span></span>
      </div>
      <button type="button" class="ncm-ptz__patrol" data-ptz-act="patrol" data-tooltip="Auto-sweep the camera head"><i class="fas fa-arrows-left-right"></i> PATROL</button>` : '';
  return `
    <div class="ncm-ptz" data-ptz-vp data-key="${_escHtml(key)}"${hasControl ? ' data-can-drive="1"' : ''}>
      <div class="ncm-ptz__clip" data-ptz-stage>
        <img src="${_escHtml(src)}" alt="${_escHtml(alt)}" draggable="false">
      </div>
      <i class="fas fa-plus ncm-ptz__cross" aria-hidden="true"></i>
      <div class="ncm-ptz__map" aria-hidden="true"><i data-ptz-map></i></div>
      <span class="ncm-ptz__read" data-ptz-read></span>
      ${pad}
    </div>`;
}

/** Initialize (or re-adopt) a mounted PTZ viewport: sizing, memory, patrol. */
function _ptzSetup(vp) {
  const img = vp.querySelector('img');
  const clip = vp.querySelector('[data-ptz-stage]');
  if (!img || !clip) return;
  const init = () => {
    const natW = img.naturalWidth || 0, natH = img.naturalHeight || 0;
    if (!natW || !natH) return;
    const vw = clip.clientWidth, vh = clip.clientHeight;
    if (!vw || !vh) return;
    const cover = Math.max(vw / natW, vh / natH);
    // The viewport shows a CROP: 2.4× past cover, but never upscale past
    // native pixels (a small image just gets a shallow pan).
    const base = Math.max(cover, Math.min(1, cover * 2.4));
    const key = vp.dataset.key;
    const st = _ptzMem.get(key) || {
      z: 1, x: null, y: null, dir: 1,
      patrol: !_reducedMotion(),
    };
    st.natW = natW; st.natH = natH; st.base = base; st.vp = vp;
    if (st.x == null) { // first sight — center the head
      st.x = (vw - natW * base * st.z) / 2;
      st.y = (vh - natH * base * st.z) / 2;
    }
    if (!vp.dataset.canDrive) st.patrol = !_reducedMotion(); // uncontrolled cams always sweep
    _ptzMem.set(key, st);
    vp.classList.add('is-ready');
    _ptzPaint(vp, st, true);
    _ptzSyncPatrolBtn(vp, st);
    if (st.patrol) _ptzStartRaf();
  };
  if (img.complete && img.naturalWidth) init();
  else img.addEventListener('load', init, { once: true });
}

/** Clamp + apply the transform, minimap box, and PAN/TILT readout. */
function _ptzPaint(vp, st, instant = false) {
  const img = vp.querySelector('img');
  const clip = vp.querySelector('[data-ptz-stage]');
  if (!img || !clip || !st.natW) return;
  const vw = clip.clientWidth, vh = clip.clientHeight;
  const s = st.base * st.z;
  const W = st.natW * s, H = st.natH * s;
  st.x = Math.min(0, Math.max(vw - W, st.x));
  st.y = Math.min(0, Math.max(vh - H, st.y));
  img.style.transition = instant ? 'none' : '';
  img.style.width = `${W}px`;
  img.style.height = `${H}px`;
  img.style.transform = `translate(${st.x}px, ${st.y}px)`;
  const map = vp.querySelector('[data-ptz-map]');
  if (map) {
    map.style.left = `${(-st.x / W) * 100}%`;
    map.style.top = `${(-st.y / H) * 100}%`;
    map.style.width = `${Math.min(100, (vw / W) * 100)}%`;
    map.style.height = `${Math.min(100, (vh / H) * 100)}%`;
  }
  const read = vp.querySelector('[data-ptz-read]');
  if (read) {
    const pan = W <= vw ? 0 : Math.round(((-st.x - (W - vw) / 2) / (W - vw)) * -90);
    const tilt = H <= vh ? 0 : Math.round(((-st.y - (H - vh) / 2) / (H - vh)) * -60);
    const sg = (n) => `${n >= 0 ? '+' : '-'}${String(Math.abs(n)).padStart(2, '0')}`;
    read.textContent = `PAN ${sg(pan)}° TILT ${sg(tilt)}° · ${st.z.toFixed(1)}×`;
  }
}

function _ptzSyncPatrolBtn(vp, st) {
  vp.querySelector('[data-ptz-act="patrol"]')?.classList.toggle('is-on', !!st.patrol);
}

/** The patrol sweep — one rAF loop for every mounted viewport; self-stopping. */
function _ptzStartRaf() {
  if (_ptzRafOn || typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
  _ptzRafOn = true;
  const step = () => {
    let alive = false;
    for (const [key, st] of _ptzMem) {
      const vp = st.vp;
      if (!vp || !vp.isConnected) continue;
      alive = true;
      if (!st.patrol || !st.natW) continue;
      const clip = vp.querySelector('[data-ptz-stage]');
      if (!clip) continue;
      const vw = clip.clientWidth;
      const W = st.natW * st.base * st.z;
      if (W <= vw + 2) continue;
      st.x -= st.dir * 0.55;
      if (st.x <= vw - W) { st.x = vw - W; st.dir = -1; }
      if (st.x >= 0) { st.x = 0; st.dir = 1; }
      _ptzPaint(vp, st, true);
      _ptzMem.set(key, st);
    }
    if (alive) requestAnimationFrame(step);
    else _ptzRafOn = false;
  };
  requestAnimationFrame(step);
}

/** A user input takes the head — patrol stops until re-armed. */
function _ptzUserTakes(vp, st) {
  if (st.patrol) { st.patrol = false; _ptzSyncPatrolBtn(vp, st); }
}

let _ptzWired = false;
(function _wirePtzOnce() {
  if (_ptzWired || typeof document === 'undefined') return;
  _ptzWired = true;
  // Pad / zoom / home / patrol — delegated so the lightbox needs no wiring.
  document.addEventListener('click', (e) => {
    const t = e.target?.closest?.('[data-ptz-act]');
    if (!t) return;
    const vp = t.closest('[data-ptz-vp]');
    const st = vp && _ptzMem.get(vp.dataset.key);
    if (!st || !st.natW) return;
    e.preventDefault(); e.stopPropagation();
    const act = t.dataset.ptzAct;
    if (act === 'pan') {
      _ptzUserTakes(vp, st);
      st.x -= Number(t.dataset.dx || 0) * 110;
      st.y -= Number(t.dataset.dy || 0) * 110;
      _ptzPaint(vp, st);
    } else if (act === 'zoom') {
      _ptzUserTakes(vp, st);
      const clip = vp.querySelector('[data-ptz-stage]');
      const vw = clip.clientWidth, vh = clip.clientHeight;
      // Zoom about the viewport center so the crosshair target holds.
      const cx = (vw / 2 - st.x) / (st.base * st.z);
      const cy = (vh / 2 - st.y) / (st.base * st.z);
      st.z = Math.min(3, Math.max(1, st.z + Number(t.dataset.dz || 0) * 0.25));
      st.x = vw / 2 - cx * st.base * st.z;
      st.y = vh / 2 - cy * st.base * st.z;
      _ptzPaint(vp, st);
    } else if (act === 'home') {
      _ptzUserTakes(vp, st);
      const clip = vp.querySelector('[data-ptz-stage]');
      st.z = 1;
      st.x = (clip.clientWidth - st.natW * st.base) / 2;
      st.y = (clip.clientHeight - st.natH * st.base) / 2;
      _ptzPaint(vp, st);
    } else if (act === 'patrol') {
      st.patrol = !st.patrol;
      _ptzSyncPatrolBtn(vp, st);
      if (st.patrol) _ptzStartRaf();
    }
  }, true);
  // Drag-to-pan on the stage itself (only when the user has control).
  document.addEventListener('pointerdown', (e) => {
    const clip = e.target?.closest?.('[data-ptz-stage]');
    const vp = clip?.closest('[data-ptz-vp]');
    if (!vp || !vp.dataset.canDrive) return;
    const st = _ptzMem.get(vp.dataset.key);
    if (!st || !st.natW) return;
    e.preventDefault();
    _ptzUserTakes(vp, st);
    const sx = e.clientX - st.x, sy = e.clientY - st.y;
    const move = (ev) => { st.x = ev.clientX - sx; st.y = ev.clientY - sy; _ptzPaint(vp, st, true); };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }, true);
})();

/**
 * Close an open NCM lightbox under `root` (used by the viewers before a
 * camAction re-render so the overlay's document listeners are cleaned).
 */
export function closeGalleryLightbox(root = null) {
  const scope = root || ((typeof document !== 'undefined') ? document : null);
  if (!scope) return;
  const wrap = scope.querySelector?.('.ncm-imgv-backdrop');
  if (wrap?._ncmClose) wrap._ncmClose();
  else wrap?.remove();
}

/**
 * Open a gallery/schematic image in the immersive NCM lightbox — a themed
 * overlay (SecurityConsole pattern: appended into `host` so it inherits that
 * viewer's --ncm-* preset; document.body = brand defaults). Corner brackets,
 * scan sweep, caption bar, click-to-zoom; ESC / backdrop / ✕ close. The GM
 * gets a SHOW PLAYERS broadcast that rides Foundry's native
 * ImagePopout.shareImage (the popout itself no longer renders locally).
 *
 * GALLERY NAVIGATION: when the clicked thumb lives inside a [data-gal-box],
 * every sibling galleryView button becomes a navigable frame — ‹ › arrows,
 * a counter, and arrow-key nav (locked/dead frames never render galleryView
 * buttons, so they're skipped by construction — nothing leaks). Single-image
 * callers (schematic stage, document figures, chat photos) get no arrows.
 *
 * FEED MONITOR SKIN: a feed cam (data-feed on the thumb) renders the monitor
 * chrome — REC + live clock (data-feed-clock, ticked by refreshFeedClocks),
 * channel counter, and the action rail (LOOP / CUT / GM restore / GM
 * Go-to-Scene) whose buttons are plain data-actions routed by the host app.
 * A PTZ cam swaps the stage for the steerable viewport (pad only with
 * control; otherwise the patrol sweep + a TAKE CONTROL gate).
 */
export function openGalleryImage(target, { host = null } = {}) {
  // The click may land on the inner <img>; the src/caption live on the button.
  const btn = target?.closest?.('[data-src]') || target;
  if (!btn?.dataset?.src) return;
  const gm = (typeof game !== 'undefined') && !!game.user?.isGM;

  // ── Gallery context: sibling frames in DOM order (viewable frames only). ──
  const box = btn.closest?.('[data-gal-box]');
  const frames = box ? [...box.querySelectorAll('[data-action="galleryView"][data-src]')] : [btn];
  let idx = Math.max(0, frames.indexOf(btn));
  const entryId = box?.dataset?.entryId || '';
  const isFeed = !!btn.dataset.feed;

  const mount = host || document.body;
  // One lightbox at a time (re-opening from the monitor rail etc.).
  closeGalleryLightbox(mount);
  const wrap = document.createElement('div');
  wrap.className = `ncm-imgv-backdrop${isFeed ? ' ncm-imgv-backdrop--feed' : ''}`;
  mount.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('is-open'));

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    // Arrow keys: on a PTZ frame they drive the camera (the pad handles it via
    // its own buttons — here we route to pan directly); otherwise they navigate.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const vp = wrap.querySelector('[data-ptz-vp][data-can-drive]');
      if (vp) {
        const st = _ptzMem.get(vp.dataset.key);
        if (st?.natW) {
          e.preventDefault(); e.stopPropagation();
          _ptzUserTakes(vp, st);
          st.x -= (e.key === 'ArrowRight' ? 1 : -1) * 110;
          _ptzPaint(vp, st);
          return;
        }
      }
      if (frames.length > 1) { e.preventDefault(); e.stopPropagation(); nav(e.key === 'ArrowRight' ? 1 : -1); }
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const vp = wrap.querySelector('[data-ptz-vp][data-can-drive]');
      const st = vp && _ptzMem.get(vp.dataset.key);
      if (st?.natW) {
        e.preventDefault(); e.stopPropagation();
        _ptzUserTakes(vp, st);
        st.y -= (e.key === 'ArrowDown' ? 1 : -1) * 110;
        _ptzPaint(vp, st);
      }
    }
  };
  const onGranted = (e) => {
    // TAKE CONTROL succeeded while this monitor is open — rebuild the stage.
    if (String(e.detail?.messageId) === String(entryId)) render();
  };
  const close = () => {
    wrap.classList.remove('is-open'); wrap.classList.add('is-closing');
    setTimeout(() => wrap.remove(), 200);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('ncm-ptz-granted', onGranted);
  };
  wrap._ncmClose = close;
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('ncm-ptz-granted', onGranted);

  const nav = (dir) => {
    idx = (idx + dir + frames.length) % frames.length;
    render();
  };

  /** Rebuild the panel for the current frame. */
  function render() {
    const f = frames[idx];
    const d = f.dataset;
    const src = d.src;
    const caption = d.caption || '';
    const label = d.label || '';
    const time = d.time || '';
    const live = d.live || ''; // '' | 'game' | 'real' — the cam's clock source
    const feed = !!d.feed;
    const ptz = !!d.ptz;
    const fIdx = Number(d.index ?? idx);
    const controlDV = Number(d.controlDv) || 0;
    const canDrive = ptz && ptzHasControl(entryId, fIdx, controlDV);
    const counter = frames.length > 1 ? `${feed ? 'CH ' : ''}${idx + 1} / ${frames.length}` : '';

    // Stage: PTZ viewport (drivable or patrol-locked) vs the plain image.
    const stage = ptz
      ? _ptzStageHtml({ key: `${entryId}::${fIdx}`, src, alt: caption || label || 'camera', hasControl: canDrive })
      : `<img src="${_escHtml(src)}" alt="${_escHtml(caption || label || 'image')}">
         <span class="ncm-imgv__scan" aria-hidden="true"></span>`;

    // Feed action rail — plain data-actions; the host app routes them (the
    // overlay lives inside the app root, so its click handling applies).
    const rail = [];
    if (feed) {
      // SAVE FRAME (#37) — only the HOST knows the exfil policy, so it stamps
      // data-save-frame (+ DV) onto the capturable thumbs in its _onRender.
      // ContentRenderers stays policy-free; the button routes to the host's own
      // exfil action (the overlay lives inside the app root, so its action map
      // applies). The dead "can't copy a stream" chip is the honest counterpart.
      if (d.saveFrame) {
        const sdv = d.saveFrameDv ? ` · DV ${_escHtml(d.saveFrameDv)}` : '';
        rail.push(`<button type="button" class="ncm-imgv__btn ncm-imgv__btn--frame" data-action="terminalExfil" data-exfil="saveFrame" data-index="${fIdx}" data-tooltip="You can’t copy a live stream — but you can capture what it’s showing"><i class="fas fa-camera"></i> SAVE FRAME${sdv}</button>`);
      }
      if (d.noCopy) rail.push(`<span class="ncm-imgv__btn ncm-imgv__btn--nocopy" data-tooltip="A live feed isn’t a file — capture a frame instead"><i class="fas fa-ban"></i> CAN’T COPY A STREAM</span>`);
      if (ptz && !canDrive) rail.push(`<button type="button" class="ncm-imgv__btn ncm-imgv__btn--ctl" data-action="camAction" data-cam-act="control" data-index="${fIdx}" data-entry-id="${_escHtml(entryId)}" data-tooltip="Seize the camera head — DV ${controlDV}"><i class="fas fa-satellite-dish"></i> TAKE CONTROL · DV ${controlDV}</button>`);
      if (d.loopDv) rail.push(`<button type="button" class="ncm-imgv__btn ncm-imgv__btn--loop" data-action="camAction" data-cam-act="loop" data-index="${fIdx}" data-entry-id="${_escHtml(entryId)}" data-tooltip="Freeze this camera on old footage"><i class="fas fa-rotate"></i> LOOP · DV ${_escHtml(d.loopDv)}</button>`);
      if (d.cutDv) rail.push(`<button type="button" class="ncm-imgv__btn ncm-imgv__btn--cut" data-action="camAction" data-cam-act="cut" data-index="${fIdx}" data-entry-id="${_escHtml(entryId)}" data-tooltip="Kill this channel"><i class="fas fa-scissors"></i> CUT FEED · DV ${_escHtml(d.cutDv)}</button>`);
      if (gm && d.sceneId) rail.push(`<button type="button" class="ncm-imgv__btn ncm-imgv__btn--gm" data-action="goToScene" data-scene-id="${_escHtml(d.sceneId)}" data-tooltip="GM — go to this camera's scene"><i class="fas fa-map"></i> GO TO SCENE</button>`);
    }

    // A PTZ panel needs a DEFINITE size: the stage is a steerable viewport
    // (height:100%), and the panel otherwise sizes to its content — an auto
    // height would collapse the stage to zero (the "monitor with no picture").
    wrap.innerHTML = `
    <div class="ncm-imgv${feed ? ' ncm-imgv--feed' : ''}${ptz ? ' ncm-imgv--ptz' : ''}" role="dialog" aria-modal="true">
      <div class="ncm-imgv__bar"></div>
      <div class="ncm-imgv__hd">
        ${feed
    ? `<span class="ncm-imgv__rec">REC</span><span class="ncm-imgv__tag ncm-imgv__tag--feed">${_escHtml(label || 'CAMERA')}</span>`
    : `<span class="ncm-imgv__tag"><i class="fas fa-expand"></i> IMAGE VIEWER</span>${label ? `<span class="ncm-imgv__label">${_escHtml(label)}</span>` : ''}`}
        ${live ? `<span class="ncm-imgv__time" data-feed-clock="${_escHtml(live)}">${_escHtml(_feedClockLabel(live))}</span>` : (time ? `<span class="ncm-imgv__time${feed ? ' ncm-imgv__time--stale' : ''}">${_escHtml(time)}</span>` : '')}
        <span class="ncm-imgv__sp"></span>
        <button type="button" class="ncm-imgv__x" data-iv="close" data-tooltip="Close"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="ncm-imgv__stage${ptz ? ' ncm-imgv__stage--ptz' : ''}"${ptz ? '' : ' data-iv="zoom" data-tooltip="Click to zoom"'}>
        ${stage}
        ${frames.length > 1 ? `
          <button type="button" class="ncm-imgv__nav ncm-imgv__nav--prev" data-iv="prev" data-tooltip="Previous"><i class="fas fa-chevron-left"></i></button>
          <button type="button" class="ncm-imgv__nav ncm-imgv__nav--next" data-iv="next" data-tooltip="Next"><i class="fas fa-chevron-right"></i></button>` : ''}
      </div>
      <div class="ncm-imgv__ft">
        <span class="ncm-imgv__cap">${_escHtml(caption) || '<i>// no caption //</i>'}</span>
        <span class="ncm-imgv__sp"></span>
        ${counter ? `<span class="ncm-imgv__idx">${_escHtml(counter)}</span>` : ''}
        ${rail.join('')}
        ${ptz ? '' : `<button type="button" class="ncm-imgv__btn" data-iv="zoom"><i class="fas fa-magnifying-glass-plus"></i> ZOOM</button>`}
        ${gm ? `<button type="button" class="ncm-imgv__btn ncm-imgv__btn--share" data-iv="share" data-tooltip="Broadcast this image to every connected player"><i class="fas fa-tower-broadcast"></i> SHOW PLAYERS</button>` : ''}
      </div>
    </div>`;
    const vp = wrap.querySelector('[data-ptz-vp]');
    if (vp) _ptzSetup(vp);
  }
  render();

  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) return close();
    const act = e.target.closest?.('[data-iv]')?.dataset.iv;
    if (act === 'close') close();
    else if (act === 'prev') nav(-1);
    else if (act === 'next') nav(1);
    else if (act === 'zoom') wrap.querySelector('.ncm-imgv')?.classList.toggle('is-zoomed');
    else if (act === 'share') shareToPlayers();
  });

  function shareToPlayers() {
    // v12: ImagePopout is a global LEXICAL binding (top-level `class` in a
    // classic script) — reference it BARE, never globalThis.ImagePopout; the
    // namespace path is the v13 fallback (standing CLAUDE.md gotcha).
    const src = frames[idx]?.dataset?.src;
    const caption = frames[idx]?.dataset?.caption || '';
    const label = frames[idx]?.dataset?.label || '';
    const Popout = (typeof ImagePopout !== 'undefined') ? ImagePopout : foundry.applications?.apps?.ImagePopout;
    if (!Popout) { ui.notifications?.warn('NCM | Image broadcast unavailable.'); return; }
    try {
      const p = new Popout(src, { title: caption || label || 'Recovered image', uuid: null });
      if (typeof p.shareImage === 'function') { p.shareImage(); ui.notifications?.info('NCM | Image shown to players.'); }
      else p.render(true);
    } catch (err) {
      log.error(`Gallery image share failed: ${err.message}`);
      ui.notifications?.error('NCM | Could not share image.');
    }
  }
}

/** Build an index-strip chip view-model for a typed entry (shard index nav). */
export function buildIndexChip(entry, { selectedId } = {}) {
  // Disguised payloads must chip as their COVER type for players — the index
  // strip is a list surface, same disguise leak as the terminal sidebar.
  const isGm = (typeof game !== 'undefined') && !!game.user?.isGM;
  const typeInfo = getContentTypeInfo(displayContentType(entry, { isGM: isGm }) ?? CONTENT_TYPES.MESSAGE);
  return {
    id: entry.id,
    title: entry.subject || 'Data Fragment',
    iconClass: typeInfo.indexIcon,
    iconColor: ACCENT_HEX[typeInfo.accent] || ACCENT_HEX.cyan,
    accentClass: `ncm-shard-index-chip--${typeInfo.accent || 'cyan'}`,
    isActive: entry.id === selectedId,
    isHidden: false,
  };
}
