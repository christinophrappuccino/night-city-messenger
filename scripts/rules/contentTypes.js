/**
 * Content types: their labels and icons, the file envelope and file names (stage 2, step 11).
 * @file scripts/rules/contentTypes.js
 * @module night-city-messenger
 *
 * Moved from the top of scripts/ui/content/ContentRenderers.js, which re-exports every name, so the services that
 * need a file name or a type's label no longer import a UI file. Pure: CONTENT_TYPES and the date formatter only.
 */

import { CONTENT_TYPES } from '../utils/constants.js';
import { formatCyberDate } from '../utils/helpers.js';


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
  const type = entry.contentType || CONTENT_TYPES.MESSAGE;
  // A program (malware/payload) is a FILE, not mail — it has no sender. Default those
  // types to the file envelope unless explicitly flagged 'mail', so even legacy program
  // entries (authored before the workshop set envelope) drop the email header. A
  // disguised program reaches here as its COVER type, so its cover still renders normally.
  const isProgram = type === CONTENT_TYPES.MALWARE || type === CONTENT_TYPES.PAYLOAD;
  const isFile = entry.envelope === 'file' || (isProgram && entry.envelope !== 'mail');
  if (!isFile) return { isFile: false };
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
