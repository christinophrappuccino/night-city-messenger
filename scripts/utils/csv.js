/**
 * @file scripts/utils/csv.js
 * @module night-city-messenger
 * @description The ONE CSV reader/writer. Pure — no Foundry globals — so sims
 *   drive it directly. Lifted out of DataShardComposer (spreadsheet / records /
 *   calendar import) on 2026-10-24 when the email directory import needed the
 *   same parser; the composer delegates here.
 */

/**
 * Minimal RFC-4180 CSV parser: quoted fields, escaped quotes (""), CRLF and
 * embedded newlines. The delimiter (comma / semicolon / tab) is auto-detected
 * from the first line. Rows that are entirely blank are dropped.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const src = String(text ?? '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].reduce((a, b) =>
    (firstLine.split(b).length > firstLine.split(a).length ? b : a));
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    }
    else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

/**
 * Quote one CSV field when it needs it (delimiter, quote, newline, or
 * leading/trailing space).
 * @param {*} value
 * @returns {string}
 */
export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialize rows to comma-separated CSV with a header line.
 * @param {Array<object>} rows
 * @param {Array<string|{key: string, label?: string}>} columns — in output order
 * @returns {string} — CRLF line endings (what spreadsheets expect)
 */
export function toCsv(rows, columns) {
  const cols = columns.map(c => (typeof c === 'string' ? { key: c, label: c } : { key: c.key, label: c.label ?? c.key }));
  const lines = [cols.map(c => csvEscape(c.label)).join(',')];
  for (const r of rows ?? []) lines.push(cols.map(c => csvEscape(r?.[c.key])).join(','));
  return lines.join('\r\n') + '\r\n';
}
