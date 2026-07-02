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
import { formatCyberDate, resolveMediaEmbed } from '../../utils/helpers.js';

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
};

/** Accent palette key → hex (index chip / dot rendering). */
export const ACCENT_HEX = Object.freeze({
  red: '#F65261', cyan: '#19f3f7', gold: '#f7c948',
  green: '#00ff41', purple: '#a855f7', danger: '#ff0033', muted: '#888888',
});

/** Resolve display info for a type, falling back to MESSAGE. */
export function getContentTypeInfo(type) {
  return CONTENT_TYPE_INFO[type] ?? CONTENT_TYPE_INFO[CONTENT_TYPES.MESSAGE];
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Authorable color names shared across content types (cells, calendar
 * categories, banking icons, status pills). CSS defines `.ncm-ct-c--<name>` /
 * `.ncm-ct-bg--<name>` and `[data-ct-color="<name>"]{--ct-c:…}` for each — the
 * one palette that kills the monochrome. Unknown names fall through to muted.
 */
export const CT_COLORS = ['green', 'gold', 'cyan', 'red', 'amber', 'purple', 'blue', 'pink', 'muted'];
function _colorName(c) { return CT_COLORS.includes(c) ? c : 'muted'; }

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

/** Human relative label for a future/past delta (ms). */
function _relLabel(diffMs) {
  if (diffMs < 0) return 'past';
  const day = 86400000;
  const days = Math.floor(diffMs / day);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor(diffMs / 3600000);
  if (hours >= 1) return `${hours}h`;
  const mins = Math.floor(diffMs / 60000);
  return mins >= 1 ? `${mins}m` : 'now';
}

/**
 * Per-type contentData enrichers. Each receives the raw `contentData` plus the
 * full `entry` and a `ctx` and returns the processed contentData the partial
 * reads. Types with no enricher render their raw contentData as-is.
 * @type {Object<string, (cd:object, entry:object, ctx:object)=>object>}
 */
const ENRICHERS = {
  [CONTENT_TYPES.EDDIES]: (cd) => ({
    ...cd,
    amountFormatted: (cd.amount ?? 0).toLocaleString(),
    claimedByName: cd.claimedBy ? (game.actors?.get(cd.claimedBy)?.name ?? 'Unknown') : '',
  }),

  [CONTENT_TYPES.DOSSIER]: (cd) => ({
    ...cd,
    hasSections: cd.sections?.length > 0,
    threatIsHigh: cd.stats?.threat?.toUpperCase() === 'HIGH',
    linkedActorImg: cd.linkedActorId ? game.actors?.get(cd.linkedActorId)?.img : null,
  }),

  [CONTENT_TYPES.PAYLOAD]: (cd) => (
    cd.executedBy
      ? { ...cd, executedByName: game.actors?.get(cd.executedBy)?.name ?? 'Unknown' }
      : { ...cd }
  ),

  [CONTENT_TYPES.AVLOG]: (cd) => {
    const media = resolveMediaEmbed(cd.mediaUrl, cd.mediaType);
    return {
      ...cd,
      isVideo: media.isVideo,
      embedSrc: media.src,
      hasMedia: media.kind !== 'none',
      isEmbed: media.kind === 'embed',
      isNativeMedia: media.kind === 'native',
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
    };
  },

  // CALENDAR — { categories?:{ name: colorName }, events:[{ title, when(iso),
  //   time?, location?, who?, note?, category?, color? }] }. Adds day/month
  //   chips, a relative countdown (timeService), soon/past state, a per-event
  //   color, an urgency fill %, and colored meta chips (time/location/who/note).
  [CONTENT_TYPES.CALENDAR]: (cd) => {
    const now = _nowMs();
    const dayMs = 86400000;
    const cats = cd.categories || {};
    const events = (cd.events || []).map(ev => {
      const t = ev.when ? Date.parse(ev.when) : NaN;
      const valid = !Number.isNaN(t);
      const d = valid ? new Date(t) : null;
      const diff = valid ? t - now : 0;
      const soon = valid && diff >= 0 && diff < 3 * dayMs;
      const chips = [];
      if (ev.time) chips.push({ icon: 'fa-regular fa-clock', text: ev.time, color: 'cyan' });
      if (ev.location) chips.push({ icon: 'fas fa-location-dot', text: ev.location, color: 'gold' });
      if (ev.who) chips.push({ icon: 'fas fa-user', text: ev.who, color: 'purple' });
      if (ev.note) chips.push({ icon: 'fas fa-note-sticky', text: ev.note, color: 'pink' });
      return {
        ...ev,
        day: d ? String(d.getUTCDate()).padStart(2, '0') : '--',
        month: d ? MONTHS[d.getUTCMonth()] : '',
        timeLabel: valid ? _relLabel(diff) : '',
        past: valid && diff < 0, soon,
        color: _colorName(ev.color || cats[ev.category] || 'cyan'),
        urgency: soon ? Math.max(10, Math.min(100, Math.round(100 - (diff / (3 * dayMs)) * 100))) : 0,
        chips,
      };
    });
    const legend = Object.entries(cats).map(([name, color]) => ({ name, color: _colorName(color) }));
    return { ...cd, events, legend, hasLegend: legend.length > 0, upcoming: events.filter(e => !e.past).length };
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
    return {
      ...cd,
      // Bank identity / lore (letterhead).
      bankName: cd.bankName || '', bankLogo: cd.bankLogo || '',
      bankLocation: cd.bankLocation || '', bankCode: cd.bankCode || '',
      bankTagline: cd.bankTagline || '',
      hasBankId: !!(cd.bankName || cd.bankLogo || cd.bankLocation || cd.bankCode),
      // Account.
      owner: cd.owner || cd.accountName || '',
      accountType: cd.accountType || '',
      currency: cd.currency || '€$',
      transactions, txnCount: transactions.length,
      balanceFormatted: (cd.balance ?? 0).toLocaleString(),
      clearedFormatted: cd.cleared != null ? Number(cd.cleared).toLocaleString() : '',
      heldFormatted: cd.held != null ? Number(cd.held).toLocaleString() : '',
      hasSplit: cd.cleared != null || cd.held != null,
      // Siphon affordance (mechanic wiring is a follow-up — see CLAUDE.md).
      allowSiphon: !!cd.allowSiphon && !cd.siphoned,
      siphoned: !!cd.siphoned,
      siphonDV: cd.siphonDV || null,
    };
  },
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

/** Build an index-strip chip view-model for a typed entry (shard index nav). */
export function buildIndexChip(entry, { selectedId } = {}) {
  const typeInfo = getContentTypeInfo(entry.contentType);
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
