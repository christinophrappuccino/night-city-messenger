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
 *
 *   Sprint 2C additions:
 *     - getAvatarColor(name, contact)  — §2.9 Color-coded avatar hash
 *     - getNetworkThemeClass(network)  — §2.10 Network-themed message classes
 *     - getThreatBadgeData(message)    — §2.7 Daemon / threat badge data
 */

// ═══════════════════════════════════════════════════════════════
//  Sprint 0 — Core Design System Helpers
// ═══════════════════════════════════════════════════════════════

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
 * @param {object} message — Message data with flags
 * @param {object} [contact] — Matched contact, if any
 * @returns {{
 *   variant: string,
 *   items: Array<{ icon: string, label: string, status: string }>,
 *   hasThreat: boolean
 * }}
 */
export function getSecurityStripData(message, contact) {
  const items = [];
  let variant = 'ok'; // ok | warn | danger

  // Sender verification
  const verified = contact && contact.verified !== false;
  items.push({
    icon: verified ? 'fas fa-user-check' : 'fas fa-user-xmark',
    label: verified ? 'VERIFIED' : 'UNKNOWN',
    status: verified ? 'ok' : 'warn',
  });

  // Encryption status
  const encrypted = message.status?.encrypted;
  items.push({
    icon: encrypted ? 'fas fa-lock' : 'fas fa-lock-open',
    label: encrypted ? 'ENCRYPTED' : 'CLEARTEXT',
    status: encrypted ? 'ok' : 'neutral',
  });

  // Attachment scan
  const hasAttachments = (message.attachments?.length ?? 0) > 0;
  if (hasAttachments) {
    const infected = message.status?.infected || message.malware;
    items.push({
      icon: infected ? 'fas fa-virus' : 'fas fa-shield-check',
      label: infected ? 'THREAT DETECTED' : 'ATTACHMENTS CLEAN',
      status: infected ? 'danger' : 'ok',
    });
    if (infected) variant = 'danger';
  }

  // Route hops (decorative — number of routing path entries)
  const hops = message.metadata?.routingPath?.length ?? 0;
  if (hops > 0) {
    items.push({
      icon: 'fas fa-route',
      label: `${hops} HOP${hops > 1 ? 'S' : ''}`,
      status: hops > 3 ? 'warn' : 'ok',
    });
    if (hops > 3 && variant !== 'danger') variant = 'warn';
  }

  // Malware / daemon detection
  const hasThreat = !!(message.status?.infected || message.malware);
  if (hasThreat) variant = 'danger';

  // Unknown sender warning
  if (!verified && variant !== 'danger') variant = 'warn';

  return { variant, items, hasThreat };
}

/**
 * §2.6/2.8 — Split attachments into encrypted and regular categories.
 *
 * @param {Array} attachments — Array of attachment objects
 * @returns {{ encrypted: Array, regular: Array }}
 */
export function classifyAttachments(attachments) {
  if (!attachments?.length) return { encrypted: [], regular: [] };

  const encrypted = [];
  const regular = [];

  for (const att of attachments) {
    if (att.encrypted || att.ice) {
      encrypted.push({
        ...att,
        fileIcon: getFileIcon(att.filename || att.name),
        dv: att.dv ?? att.ice?.dv ?? 15,
      });
    } else {
      regular.push({
        ...att,
        fileIcon: getFileIcon(att.filename || att.name),
      });
    }
  }

  return { encrypted, regular };
}


// ═══════════════════════════════════════════════════════════════
//  Sprint 2C Additions
// ═══════════════════════════════════════════════════════════════

/**
 * §2.9 — Cyberpunk avatar color palette.
 * 10 distinct neon/cyberpunk colors for name-hashed avatar backgrounds.
 * @type {string[]}
 */
const AVATAR_PALETTE = [
  '#19f3f7', // cyan
  '#F65261', // red
  '#f7c948', // gold
  '#b44dff', // purple
  '#00ff41', // green
  '#ff6a13', // orange
  '#ff69b4', // pink
  '#00bcd4', // teal
  '#8bc34a', // lime
  '#ff5722', // deep orange
];

/**
 * §2.9 — Faction-to-color override map.
 * If a contact has a faction/role flag, this takes precedence over the name hash.
 * @type {Record<string, string>}
 */
const FACTION_COLORS = {
  fixer:       '#F65261', // red
  netrunner:   '#19f3f7', // cyan
  corp:        '#f7c948', // gold
  corporate:   '#f7c948', // gold (alias)
  gang:        '#b44dff', // purple
  ncpd:        '#4a9eff', // blue
  police:      '#4a9eff', // blue (alias)
  traumateam:  '#00ff41', // green
  'trauma team': '#00ff41', // green (alias)
  solo:        '#ff6a13', // orange
  media:       '#ff69b4', // pink
  techie:      '#00bcd4', // teal
  tech:        '#00bcd4', // teal (alias)
  nomad:       '#8bc34a', // lime
  rockerboy:   '#ff5722', // deep orange
  medtech:     '#00ff41', // green
  lawman:      '#4a9eff', // blue
  exec:        '#f7c948', // gold
};

/**
 * §2.9 — Compute a deterministic avatar color from a sender name.
 * Uses a simple char-code hash modulo palette length so the same name
 * always maps to the same color. If the contact has a faction/role flag,
 * faction color takes precedence.
 *
 * @param {string} name — Sender display name
 * @param {object} [contact] — Optional contact with faction/role data
 * @returns {string} Hex color string (e.g. '#19f3f7')
 *
 * @example
 *   getAvatarColor('V')                          // → '#ff6a13'  (hash-based)
 *   getAvatarColor('Rogue', { faction: 'fixer' }) // → '#F65261'  (faction override)
 */
export function getAvatarColor(name, contact) {
  // Faction override — check contact role/faction
  if (contact) {
    const faction = (contact.faction || contact.role || '').toLowerCase().trim();
    if (faction && FACTION_COLORS[faction]) {
      return FACTION_COLORS[faction];
    }
  }

  // Name hash — sum of char codes modulo palette length
  if (!name) return AVATAR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0; // djb2-ish hash
  }
  const index = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index];
}

/**
 * §2.10 — Known network theme map.
 * Maps canonical network names (lowercased) to CSS theme class suffixes.
 * @type {Record<string, string>}
 */
const NETWORK_THEME_MAP = {
  citinet:  'citinet',
  darknet:  'darknet',
  corpnet:  'corpnet',
  'dark net': 'darknet',
  'corp net': 'corpnet',
  'citi net': 'citinet',
};

/**
 * §2.10 — Determine the network theme CSS class for a message.
 * Returns a class like 'ncm-msg--darknet' for known networks,
 * or 'ncm-msg--citinet' (default) for unknown/custom networks.
 *
 * @param {string} networkName — Network identifier from message flags
 * @returns {string} Full CSS class (e.g. 'ncm-msg--darknet')
 *
 * @example
 *   getNetworkThemeClass('DARKNET')   // → 'ncm-msg--darknet'
 *   getNetworkThemeClass('MyCustom')  // → 'ncm-msg--citinet'
 *   getNetworkThemeClass('')          // → 'ncm-msg--citinet'
 */
export function getNetworkThemeClass(networkName) {
  if (!networkName) return 'ncm-msg--citinet';
  const key = networkName.toLowerCase().trim();
  const suffix = NETWORK_THEME_MAP[key] || 'citinet';
  return `ncm-msg--${suffix}`;
}

/**
 * §2.10 — Get the network theme color for avatar border tinting.
 * Returns a hex color for the network's accent or null for default (citinet).
 *
 * @param {string} networkName — Network identifier
 * @returns {string|null} Hex color or null
 */
export function getNetworkAccentColor(networkName) {
  if (!networkName) return null;
  const key = networkName.toLowerCase().trim();
  switch (NETWORK_THEME_MAP[key]) {
    case 'darknet': return '#b44dff';
    case 'corpnet': return '#f7c948';
    default:        return null; // citinet uses default styling
  }
}

/**
 * §2.7 — Build threat badge data for messages carrying malware.
 * Returns null if no threat is present, or an object with badge rendering data.
 *
 * @param {object} message — Message with status and malware flags
 * @returns {null | {
 *   label: string,
 *   icon: string,
 *   type: string,
 *   variant: string
 * }}
 *
 * @example
 *   getThreatBadgeData({ malware: { type: 'DAEMON' } })
 *   // → { label: 'DAEMON', icon: 'fas fa-virus', type: 'DAEMON', variant: 'threat' }
 *
 *   getThreatBadgeData({ status: { infected: false } })
 *   // → null
 */
export function getThreatBadgeData(message) {
  if (!message) return null;

  // Check for explicit malware data
  const malware = message.malware;
  const isInfected = message.status?.infected;

  if (!malware && !isInfected) return null;

  // Determine malware type label
  const type = malware?.type || 'UNKNOWN';
  const typeUpper = type.toUpperCase();

  // Icon varies by malware type
  const iconMap = {
    DAEMON:      'fas fa-virus',
    WORM:        'fas fa-bug',
    TROJAN:      'fas fa-mask',
    VIRUS:       'fas fa-virus',
    RANSOMWARE:  'fas fa-lock',
    BLACK_ICE:   'fas fa-skull',
    BLACKICE:    'fas fa-skull',
    'BLACK ICE': 'fas fa-skull',
    UNKNOWN:     'fas fa-virus',
  };

  // Badge class suffix — matches CSS .ncm-badge--{class}
  const classMap = {
    DAEMON:      'daemon',
    WORM:        'worm',
    TROJAN:      'trojan',
    VIRUS:       'daemon',
    RANSOMWARE:  'trojan',
    BLACK_ICE:   'black-ice',
    BLACKICE:    'black-ice',
    'BLACK ICE': 'black-ice',
    UNKNOWN:     'threat',
  };

  return {
    label: typeUpper === 'UNKNOWN' ? 'THREAT' : typeUpper,
    icon: iconMap[typeUpper] || 'fas fa-virus',
    type: typeUpper,
    variant: classMap[typeUpper] || 'threat',
  };
}

// ═══════════════════════════════════════════════════════════════
//  Sprint 3 — Contact Display Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Role icon mapping — Cyberpunk RED roles to FontAwesome icons.
 * @type {Record<string, string>}
 */
const ROLE_ICONS = {
  fixer:      'fa-crosshairs',
  netrunner:  'fa-terminal',
  runner:     'fa-terminal',
  solo:       'fa-gun',
  tech:       'fa-screwdriver-wrench',
  medtech:    'fa-kit-medical',
  ripperdoc:  'fa-syringe',
  media:      'fa-camera',
  exec:       'fa-building-columns',
  lawman:     'fa-shield-halved',
  nomad:      'fa-van-shuttle',
  rockerboy:  'fa-guitar',
  rocker:     'fa-guitar',
  corp:       'fa-building',
  gang:       'fa-users-line',
  civilian:   'fa-user',
  government: 'fa-landmark',
  ai:         'fa-microchip',
};

/**
 * §3.5 — Get trust level class and description for display.
 * @param {number} trust — 0-5
 * @returns {{ level: string, class: string, description: string, segments: boolean[] }}
 */
export function getTrustData(trust) {
  const segments = [1, 2, 3, 4, 5].map(i => i <= trust);
  const segmentsDetail = [1, 2, 3, 4, 5].map(value => ({ value, active: value <= trust }));

  if (trust >= 4) {
    return {
      level: 'high', class: 'ncm-trust--high',
      description: 'HIGH — Reliable, proven track record',
      segments,
      segmentsDetail,
    };
  }
  if (trust === 3) {
    return {
      level: 'med', class: 'ncm-trust--med',
      description: 'MEDIUM — Proceed with caution',
      segments,
      segmentsDetail,
    };
  }
  if (trust >= 1) {
    return {
      level: 'low', class: 'ncm-trust--low',
      description: 'LOW — Known risk, verify everything',
      segments,
      segmentsDetail,
    };
  }
  return {
    level: 'unknown', class: 'ncm-trust--unknown',
    description: 'UNKNOWN — No established history',
    segments,
    segmentsDetail,
  };
}

/**
 * §3.1 — Get the icon class for a Cyberpunk RED role.
 * @param {string} role — Role name (case-insensitive)
 * @returns {string} FontAwesome icon class
 */
export function getRoleIcon(role) {
  if (!role) return 'fa-user';
  return ROLE_ICONS[role.toLowerCase().trim()] || 'fa-user';
}

/**
 * §3.1 — Derive contact status for display.
 * Priority: statusOverride > linked actor online state > 'offline'.
 * @param {object} contact — Contact data
 * @returns {string} Status key: 'active'|'online'|'idle'|'offline'|'dead-zone'
 */
export function getContactStatus(contact) {
  // Explicit override set by GM
  if (contact.statusOverride) return contact.statusOverride;

  // Burned contacts always show dead-zone
  if (contact.burned) return 'dead-zone';

  // If linked to an actor, check if that actor's owner is online
  if (contact.actorId) {
    const actor = game.actors.get(contact.actorId);
    if (actor) {
      const ownerUser = game.users.find(u => !u.isGM && actor.testUserPermission(u, 'OWNER'));
      if (ownerUser?.active) return 'online';
    }
  }

  return 'offline';
}

/**
 * §3.1 — Get network class suffix for a contact's network.
 * @param {string} network — Network name
 * @returns {string} CSS class suffix: 'citinet'|'darknet'|'corpnet'
 */
export function getContactNetworkClass(network) {
  if (!network) return 'citinet';
  const key = network.toLowerCase().trim();
  if (key === 'darknet' || key === 'dark net') return 'darknet';
  if (key === 'corpnet' || key === 'corp net') return 'corpnet';
  return 'citinet';
}

/**
 * §3.1 — Full contact enrichment for template rendering.
 * Takes raw contact data and adds all display-computed fields.
 *
 * @param {object} contact — Raw contact from ContactRepository
 * @param {object} [options] — { selectedId, currentNetwork, isGM }
 * @returns {object} Enriched contact ready for Handlebars
 */
export function enrichContactForDisplay(contact, options = {}) {
  const avatarColor = getAvatarColor(contact.name, contact);
  const trustData = getTrustData(contact.trust);
  const status = getContactStatus(contact);
  const networkClass = getContactNetworkClass(contact.network);
  const roleIcon = getRoleIcon(contact.role);
  const initials = getInitials(contact.name);

  // Portrait fallback chain: custom portrait > linked actor img > initials
  let portraitSrc = contact.portrait || '';
  if (!portraitSrc && contact.actorId) {
    const actor = game.actors.get(contact.actorId);
    if (actor?.img && actor.img !== 'icons/svg/mystery-man.svg') {
      portraitSrc = actor.img;
    }
  }

  // Avatar border color: network-themed or avatar-color based
  let avatarBorderColor;
  if (contact.burned) {
    avatarBorderColor = 'rgba(255, 0, 51, 0.4)';
  } else if (networkClass === 'darknet') {
    avatarBorderColor = 'rgba(180, 77, 255, 0.5)';
  } else if (networkClass === 'corpnet') {
    avatarBorderColor = 'rgba(247, 201, 72, 0.5)';
  } else {
    avatarBorderColor = avatarColor + '40'; // 25% opacity hex
  }

  return {
    ...contact,

    // Display fields
    avatarColor,
    avatarBorderColor,
    initials,
    portraitSrc,
    hasPortrait: !!portraitSrc,
    roleIcon,
    roleLabel: (contact.role || 'unknown').toUpperCase(),

    // Trust
    trustData,
    trustClass: trustData.class,
    trustSegments: trustData.segments,
    isUnverified: contact.trust === 0 && !contact.encrypted,

    // Status
    status,
    statusClass: `ncm-card__status--${status}`,
    listStatusClass: `ncm-list-item__status--${status}`,

    // Network
    networkClass,
    cardNetworkClass: `ncm-card__network--${networkClass}`,

    // State flags
    isBurned: contact.burned,
    isEncrypted: contact.encrypted,
    isFavorite: contact.favorite,
    isSelected: contact.id === options.selectedId,

    // Trust detail segments
    trustSegmentsDetail: trustData.segmentsDetail,

    // GM flag for overlay bypass button
    isGM: options.isGM ?? game.user?.isGM ?? false,

    // Card CSS classes (composed)
    cardClasses: [
      'ncm-card',
      contact.id === options.selectedId ? 'ncm-card--selected' : '',
      contact.burned ? 'ncm-card--burned' : '',
      contact.encrypted ? 'ncm-card--encrypted' : '',
    ].filter(Boolean).join(' '),

    listClasses: [
      'ncm-list-item',
      contact.id === options.selectedId ? 'ncm-list-item--selected' : '',
      contact.burned ? 'ncm-list-item--burned' : '',
      contact.encrypted ? 'ncm-list-item--encrypted' : '',
      !contact.burned && !contact.encrypted && networkClass !== 'citinet' ? `ncm-list-item--${networkClass}` : '',
    ].filter(Boolean).join(' '),

    // Tags display
    hasTags: contact.tags && contact.tags.length > 0,
    displayTags: contact.tags ? contact.tags.join(', ') : '',
  };
}
