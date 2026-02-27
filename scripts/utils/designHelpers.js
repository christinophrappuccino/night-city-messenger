/**
 * Design System Helpers
 * @file scripts/utils/designHelpers.js
 * @module cyberpunkred-messenger
 * @description Utility functions for computing data needed by the Sprint 0
 *   design system partials. Use these in _prepareContext() to build the
 *   objects that Handlebars templates expect.
 *
 *   Sprint 2B additions:
 *     - getFileIcon(extension)        — §2.8 Attachment chip file type icons
 *     - getSecurityStripData(message)  — §2.4 Security verification strip data
 *     - classifyAttachments(attachments) — §2.6/2.8 Split encrypted vs regular
 */

/**
 * Compute signal bar data for the signal-bar.hbs partial.
 * @param {number} strength — Signal strength 0-100
 * @returns {{ strength: number, quality: string, segments: boolean[] }}
 *
 * @example
 *   import { computeSignalBar } from '../../utils/designHelpers.js';
 *   const signal = computeSignalBar(75);
 *   // → { strength: 75, quality: 'strong', segments: [true, true, true, true, false] }
 */
export function computeSignalBar(strength) {
  const clamped = Math.max(0, Math.min(100, strength));
  const active = Math.ceil(clamped / 20);
  const quality = clamped === 0 ? 'dead'
    : clamped <= 25 ? 'weak'
    : clamped <= 50 ? 'fair'
    : 'strong';

  return {
    strength: clamped,
    quality,
    segments: [1, 2, 3, 4, 5].map(i => i <= active),
  };
}

/**
 * Compute progress bar data for the progress-bar.hbs partial.
 * @param {number} value — Current value
 * @param {number} max — Maximum value
 * @param {string} [label] — Label text
 * @returns {{ value: number, display: string, label?: string, color?: string }}
 */
export function computeProgressBar(value, max, label) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const color = pct <= 25 ? 'danger' : pct <= 50 ? 'warning' : undefined;

  return {
    value: pct,
    display: `${pct}%`,
    label,
    color,
  };
}

/**
 * Build stat grid data from key-value pairs.
 * @param {Array<{label: string, value: string|number, color?: string, pulse?: boolean}>} stats
 * @param {number} [columns] — Fixed column count (2, 3, or 4)
 * @returns {{ stats: Array, columns?: number }}
 */
export function buildStatGrid(stats, columns) {
  return { stats, columns };
}

/**
 * Extract initials from a name (first letter of first and last name).
 * @param {string} name
 * @returns {string} 1-2 character initials
 */
export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Build entity card data for the entity-card.hbs partial.
 * @param {object} params
 * @param {string} params.name
 * @param {string} [params.portrait]
 * @param {string} [params.subtitle]
 * @param {string} [params.role]
 * @param {string} [params.roleLabel]
 * @param {Array} [params.stats]
 * @param {boolean} [params.selected]
 * @param {string} [params.dataId]
 * @returns {object} Ready-to-render entity card context
 */
export function buildEntityCard({ name, portrait, subtitle, role, roleLabel, stats, selected, dataId }) {
  return {
    name,
    portrait: portrait || null,
    initials: portrait ? null : getInitials(name),
    subtitle,
    role,
    roleLabel: roleLabel || role?.toUpperCase(),
    stats: stats || [],
    selected: !!selected,
    dataId,
  };
}

/**
 * Determine priority badge variant from priority string.
 * @param {string} priority — "normal" | "urgent" | "critical"
 * @returns {string} Badge variant class suffix
 */
export function getPriorityBadgeVariant(priority) {
  const map = {
    normal: 'priority-normal',
    urgent: 'priority-urgent',
    critical: 'priority-critical',
  };
  return map[priority] || 'priority-normal';
}


// ═══════════════════════════════════════════════════════════════
//  Sprint 2B Additions
// ═══════════════════════════════════════════════════════════════

/**
 * §2.8 — Map file extension to FontAwesome icon class.
 * Used by attachment-chip.hbs to display appropriate file type icons.
 *
 * @param {string} filename — Full filename or extension (e.g. "report.pdf" or "pdf")
 * @returns {string} FontAwesome icon class string
 *
 * @example
 *   getFileIcon('clinic_map.png')    // → 'fas fa-image'
 *   getFileIcon('chrome_manifest.dat') // → 'fas fa-database'
 *   getFileIcon('unknown')            // → 'fas fa-file'
 */
export function getFileIcon(filename) {
  if (!filename) return 'fas fa-file';

  // Extract extension: handle both "file.ext" and bare "ext"
  const ext = filename.includes('.')
    ? filename.split('.').pop().toLowerCase()
    : filename.toLowerCase();

  const iconMap = {
    // Images
    png:  'fas fa-image',
    jpg:  'fas fa-image',
    jpeg: 'fas fa-image',
    gif:  'fas fa-image',
    webp: 'fas fa-image',
    svg:  'fas fa-image',
    bmp:  'fas fa-image',

    // Documents
    txt:  'fas fa-file-lines',
    doc:  'fas fa-file-lines',
    docx: 'fas fa-file-lines',
    pdf:  'fas fa-file-pdf',
    rtf:  'fas fa-file-lines',
    md:   'fas fa-file-lines',

    // Data
    dat:  'fas fa-database',
    db:   'fas fa-database',
    sql:  'fas fa-database',
    csv:  'fas fa-file-csv',
    json: 'fas fa-file-code',
    xml:  'fas fa-file-code',

    // Executables / Binaries
    exe:  'fas fa-terminal',
    bin:  'fas fa-terminal',
    sh:   'fas fa-terminal',
    bat:  'fas fa-terminal',
    cmd:  'fas fa-terminal',

    // Audio
    mp3:  'fas fa-volume-high',
    ogg:  'fas fa-volume-high',
    wav:  'fas fa-volume-high',
    flac: 'fas fa-volume-high',

    // Video
    mp4:  'fas fa-film',
    avi:  'fas fa-film',
    mkv:  'fas fa-film',
    webm: 'fas fa-film',

    // Archives
    zip:  'fas fa-file-zipper',
    rar:  'fas fa-file-zipper',
    '7z': 'fas fa-file-zipper',
    tar:  'fas fa-file-zipper',
    gz:   'fas fa-file-zipper',

    // Code
    js:   'fas fa-file-code',
    py:   'fas fa-file-code',
    html: 'fas fa-file-code',
    css:  'fas fa-file-code',
    cpp:  'fas fa-file-code',
    c:    'fas fa-file-code',
  };

  return iconMap[ext] || 'fas fa-file';
}

/**
 * §2.4 — Compute security verification strip data from message flags.
 * Returns an object ready for the security strip template.
 *
 * @param {object} msg — Raw message data with flags
 * @param {object|null} contact — Contact entry if sender is known, null otherwise
 * @returns {object} Security strip context
 *
 * @example
 *   const security = getSecurityStripData(msg, contact);
 *   // → {
 *   //     verifiedSender: true,
 *   //     verifiedVariant: 'ok',
 *   //     encrypted: true,
 *   //     encryptedVariant: 'ok',
 *   //     attachmentScan: 'clean',
 *   //     attachmentScanVariant: 'ok',
 *   //     attachmentScanLabel: 'ATTACHMENTS CLEAN',
 *   //     routeHops: 3,
 *   //     securityLevel: 'ok'    // Worst-of: 'ok' | 'warn' | 'danger'
 *   //   }
 */
export function getSecurityStripData(msg, contact = null) {
  if (!msg) return null;

  const status = msg.status || {};
  const metadata = msg.metadata || {};
  const malware = msg.malware || null;
  const attachments = msg.attachments || [];

  // Verified sender: known contact = ok, unknown = muted
  const verifiedSender = !!(contact || metadata.verified);
  const verifiedVariant = verifiedSender ? 'ok' : 'muted';

  // Encryption status
  const encrypted = !!status.encrypted;
  const encryptedVariant = encrypted ? 'ok' : 'muted';

  // Attachment scan — check for encrypted or malware attachments
  const hasEncryptedAttachments = attachments.some(a => a.encrypted);
  const hasMalware = !!malware || status.infected;

  let attachmentScan, attachmentScanVariant, attachmentScanLabel;

  if (hasMalware) {
    attachmentScan = 'danger';
    attachmentScanVariant = 'danger';
    const malwareType = (typeof malware === 'object' ? malware.type : malware) || 'DAEMON';
    attachmentScanLabel = `⚠ ${malwareType.toUpperCase()} DETECTED`;
  } else if (hasEncryptedAttachments) {
    const iceCount = attachments.filter(a => a.encrypted).length;
    attachmentScan = 'warn';
    attachmentScanVariant = 'warn';
    attachmentScanLabel = `${iceCount} ICE ATTACHMENT${iceCount > 1 ? 'S' : ''}`;
  } else if (attachments.length > 0) {
    attachmentScan = 'clean';
    attachmentScanVariant = 'ok';
    attachmentScanLabel = 'ATTACHMENTS CLEAN';
  } else {
    attachmentScan = 'none';
    attachmentScanVariant = 'muted';
    attachmentScanLabel = 'NO ATTACHMENTS';
  }

  // Route hops from routing path
  const routeHops = metadata.routingPath?.length || 1;

  // Overall security level = worst of all items
  let securityLevel = 'ok';
  if (hasMalware) {
    securityLevel = 'danger';
  } else if (hasEncryptedAttachments || !verifiedSender) {
    securityLevel = 'warn';
  }

  return {
    verifiedSender,
    verifiedVariant,
    encrypted,
    encryptedVariant,
    attachmentScan,
    attachmentScanVariant,
    attachmentScanLabel,
    routeHops,
    securityLevel,
  };
}

/**
 * §2.6/2.8 — Split attachments into encrypted and regular categories.
 * Enriches each attachment with icon and extension data.
 *
 * @param {Array} attachments — Raw attachment array from message flags
 * @returns {{ encrypted: Array, regular: Array }}
 *
 * @example
 *   const { encrypted, regular } = classifyAttachments(msg.attachments);
 *   // encrypted: [{ name, size, encrypted: true, dv: 15, icon, ... }]
 *   // regular:   [{ name, size, icon: 'fas fa-image', extension: 'png', ... }]
 */
export function classifyAttachments(attachments) {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return { encrypted: [], regular: [] };
  }

  const encrypted = [];
  const regular = [];

  attachments.forEach((att, index) => {
    const name = att.name || 'unknown_file';
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const icon = getFileIcon(name);
    const size = att.size || '';

    const enriched = {
      ...att,
      name,
      size,
      icon,
      extension,
      index,
    };

    if (att.encrypted) {
      encrypted.push({
        ...enriched,
        dv: att.dv || att.encryptionDC || 15,
        decrypted: !!att.decrypted,
        breachFailed: !!att.breachFailed,
        breaching: !!att.breaching,
      });
    } else {
      regular.push(enriched);
    }
  });

  return { encrypted, regular };
}
