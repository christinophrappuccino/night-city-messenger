/**
 * Module Constants
 * @file scripts/utils/constants.js
 * @module cyberpunkred-messenger
 * @description Single source of truth for all module constants
 */

export const MODULE_ID = 'cyberpunkred-messenger';
export const MODULE_TITLE = 'Night City Messenger';
export const MODULE_SHORT = 'NCM';

// ─── EventBus Event Names ───

export const EVENTS = Object.freeze({
  MESSAGE_SENT: 'message:sent',
  MESSAGE_RECEIVED: 'message:received',
  MESSAGE_READ: 'message:read',
  MESSAGE_DELETED: 'message:deleted',
  MESSAGE_SCHEDULED: 'message:scheduled',
  MESSAGE_STATUS_CHANGED: 'message:statusChanged',
  MESSAGE_ACCESS_GRANTED: 'message:access:granted',
  MESSAGE_ACCESS_REVOKED: 'message:access:revoked',
  MESSAGE_ACCESS_DENIED: 'message:access:denied',
  INBOX_REFRESH: 'inbox:refresh',
  QUEUE_FLUSHED: 'queue:flushed',

  CONTACT_BURNED:        'contacts:burned',
  CONTACT_SHARED:        'contacts:shared',
  CONTACT_SHARE_STARTED: 'contacts:shareStarted',
  CONTACT_TRUST_CHANGED: 'contacts:trustChanged',
  CONTACT_TAGS_UPDATED:  'contacts:tagsUpdated',
  CONTACT_DECRYPTED:      'contacts:decrypted',
  CONTACT_BREACH_FAILED:  'contacts:breachFailed',
  CONTACTS_REVERIFIED:          'contacts:reverified',
  CONTACT_VERIFIED:             'contacts:verified',
  CONTACT_VERIFICATION_FAILED:  'contacts:verificationFailed',

  NETWORK_CHANGED: 'network:changed',
  NETWORK_CONNECTED: 'network:connected',
  NETWORK_DISCONNECTED: 'network:disconnected',
  NETWORK_AUTH_SUCCESS: 'network:authSuccess',
  NETWORK_AUTH_FAILURE: 'network:authFailure',
  NETWORK_LOCKOUT: 'network:lockout',

  SHARD_CREATED: 'shard:created',
  SHARD_OPENED: 'shard:opened',
  SHARD_HACK_ATTEMPT: 'shard:hackAttempt',
  SHARD_DECRYPTED: 'shard:decrypted',
  SHARD_BLACK_ICE: 'shard:blackICE',
  SHARD_KEY_ITEM_PRESENTED: 'shard:keyItemPresented',
  SHARD_KEY_ITEM_FAILED: 'shard:keyItemFailed',
  SHARD_LOGIN_SUCCESS: 'shard:loginSuccess',
  SHARD_LOGIN_FAILURE: 'shard:loginFailure',
  SHARD_RELOCKED: 'shard:relocked',
  SHARD_INTEGRITY_CHANGED: 'shard:integrityChanged',
  SHARD_INTEGRITY_BRICKED: 'shard:integrityBricked',
  SHARD_ENTRY_CORRUPTED: 'shard:entryCorrupted',
  SHARD_EDDIES_CLAIMED: 'shard:eddiesClaimed',
  SHARD_BOOT_STARTED: 'shard:bootStarted',
  SHARD_BOOT_COMPLETE: 'shard:bootComplete',
  SHARD_TRACE_FIRED: 'shard:traceFired',
  SHARD_EXPIRED: 'shard:expired',
  SHARD_PRESET_APPLIED: 'shard:presetApplied',

  SHARD_STATE_CHANGED: 'shard:stateChanged',
  CONTACT_UPDATED: 'contact:updated',
  INBOX_REFRESH: 'inbox:refresh',
  MESSAGE_STATUS_CHANGED: 'message:statusChanged',
  SCHEDULE_UPDATED: 'schedule:updated',

  TOAST_SHOW: 'toast:show',
  TOAST_DISMISS: 'toast:dismiss',
  TOAST_ACTION: 'toast:action',

  UI_VIEWER_OPENED: 'ui:viewerOpened',
  UI_COMPOSER_OPENED: 'ui:composerOpened',
  COMPOSER_OPEN: 'composer:open',

  THEME_CHANGED: 'theme:changed',
});

// ─── Socket Operations ───

export const SOCKET_OPS = Object.freeze({
  MESSAGE_RELAY: 'message:relay',
  MESSAGE_DELIVERED: 'message:delivered',
  MESSAGE_NOTIFY: 'message:notify',
  MESSAGE_STATUS_UPDATE: 'message:statusUpdate',
  SCHEDULE_SYNC: 'schedule:sync',
  INBOX_REFRESH: 'inbox:refresh',
  NETWORK_STATE_CHANGED: 'network:stateChanged',
  SHARD_STATE_CHANGED: 'shard:stateChanged',
  CONTACT_SHARE_RELAY:   'contact:shareRelay',
  CONTACT_SHARE_NOTIFY:  'contact:shareNotify',
  CONTACT_SHARE_CONFIRM: 'contact:shareConfirm',
  TRACE_COMPLETE:        'network:traceComplete',
});

// ─── Network Types ───

export const NETWORK_TYPES = Object.freeze({
  PUBLIC: 'PUBLIC', CORPORATE: 'CORPORATE', UNDERGROUND: 'UNDERGROUND',
  GOVERNMENT: 'GOVERNMENT', CUSTOM: 'CUSTOM',
});

export const SECURITY_LEVELS = Object.freeze({
  NONE: 'NONE', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', MAXIMUM: 'MAXIMUM',
});

export const NETWORKS = Object.freeze({
  CITINET: 'CITINET', CORPNET: 'CORPNET', DARKNET: 'DARKNET',
  GOVNET: 'GOVNET', DATA_POOL: 'DATA_POOL',
});

// ─── Encryption / Priority / Failure ───

export const ENCRYPTION_TYPES = Object.freeze({ ICE: 'ICE', BLACK_ICE: 'BLACK_ICE', RED_ICE: 'RED_ICE' });
export const ENCRYPTION_MODES = Object.freeze({ SHARD: 'shard', MESSAGE: 'message' });
export const MESSAGE_PRIORITY = Object.freeze({ NORMAL: 'normal', URGENT: 'urgent', CRITICAL: 'critical' });
export const FAILURE_MODES = Object.freeze({ NOTHING: 'nothing', LOCKOUT: 'lockout', PERMANENT: 'permanent', DAMAGE: 'damage', DESTROY: 'destroy' });

// ─── Data Shard Enums (Sprint 4.6) ───

export const CONTENT_TYPES = Object.freeze({
  MESSAGE: 'message', EDDIES: 'eddies', DOSSIER: 'dossier',
  PAYLOAD: 'payload', AVLOG: 'avlog', LOCATION: 'location',
});

export const NETWORK_ACCESS_MODES = Object.freeze({
  ANY: 'any', WHITELIST: 'whitelist', TYPE: 'type', BOTH: 'both',
});

export const CONNECTION_MODES = Object.freeze({
  OFFLINE: 'offline', TETHERED: 'tethered',
});

export const BOOT_SPEEDS = Object.freeze({
  FAST: 'fast', NORMAL: 'normal', DRAMATIC: 'dramatic',
});

export const INTEGRITY_MODES = Object.freeze({
  OFF: 'off', COSMETIC: 'cosmetic', MECHANICAL: 'mechanical',
});

export const TRACE_MODES = Object.freeze({
  SILENT: 'silent', WARNED: 'warned', VISIBLE: 'visible',
});

// ─── Skill Map ───

export const SKILL_MAP = Object.freeze({
  'Interface':                  { stat: 'tech', category: 'TECH' },
  'Electronics/Security Tech':  { stat: 'tech', category: 'TECH' },
  'Basic Tech':                 { stat: 'tech', category: 'TECH' },
  'Cybertech':                  { stat: 'tech', category: 'TECH' },
  'Weaponstech':                { stat: 'tech', category: 'TECH' },
  'Forgery':                    { stat: 'tech', category: 'TECH' },
  'Demolitions':                { stat: 'tech', category: 'TECH' },
  'Pick Lock':                  { stat: 'tech', category: 'TECH' },
  'Cryptography':               { stat: 'int', category: 'INT' },
  'Library Search':             { stat: 'int', category: 'INT' },
  'Deduction':                  { stat: 'int', category: 'INT' },
  'Education':                  { stat: 'int', category: 'INT' },
  'Science':                    { stat: 'int', category: 'INT' },
  'Perception':                 { stat: 'int', category: 'INT' },
  'Bureaucracy':                { stat: 'int', category: 'INT' },
  'Business':                   { stat: 'int', category: 'INT' },
  'Accounting':                 { stat: 'int', category: 'INT' },
  'Persuasion':                 { stat: 'cool', category: 'COOL' },
  'Bribery':                    { stat: 'cool', category: 'COOL' },
  'Interrogation':              { stat: 'cool', category: 'COOL' },
  'Streetwise':                 { stat: 'cool', category: 'COOL' },
  'Trading':                    { stat: 'cool', category: 'COOL' },
  'Wardrobe & Style':           { stat: 'cool', category: 'COOL' },
  'Concentration':              { stat: 'will', category: 'WILL' },
  'Endurance':                  { stat: 'will', category: 'WILL' },
  'Resist Torture/Drugs':       { stat: 'will', category: 'WILL' },
  'Stealth':                    { stat: 'dex', category: 'DEX' },
  'Contortionist':              { stat: 'dex', category: 'DEX' },
  'Pick Pocket':                { stat: 'dex', category: 'DEX' },
  'Conversation':               { stat: 'emp', category: 'EMP' },
  'Human Perception':           { stat: 'emp', category: 'EMP' },
});

// ─── Skill Presets ───

export const SKILL_PRESETS = Object.freeze({
  HACKING:             { skills: ['Interface', 'Electronics/Security Tech'], description: 'Direct ICE breach' },
  CRYPTANALYSIS:       { skills: ['Cryptography', 'Science', 'Education'], description: 'Code breaking' },
  RESEARCH:            { skills: ['Library Search', 'Deduction', 'Perception'], description: 'Info gathering' },
  SOCIAL_ENGINEERING:  { skills: ['Persuasion', 'Bribery', 'Interrogation', 'Streetwise'], description: 'Social manipulation' },
  CORPORATE:           { skills: ['Bureaucracy', 'Business', 'Accounting', 'Forgery'], description: 'Corp procedures' },
  PHYSICAL_BYPASS:     { skills: ['Pick Lock', 'Electronics/Security Tech', 'Demolitions'], description: 'Physical bypass' },
  FULL_SPECTRUM:       { skills: ['Interface', 'Electronics/Security Tech', 'Cryptography', 'Persuasion', 'Library Search', 'Forgery', 'Pick Lock'], description: 'Any approach' },
});

// ─── Theme Presets ───

export const THEME_PRESETS = Object.freeze({
  classic:    { label: 'Classic',     primary: '#F65261', secondary: '#19f3f7', accent: '#f7c948', bgDeep: '#0a0a0f', bgBase: '#12121a', bgSurface: '#1a1a2e', bgElevated: '#252540', textPrimary: '#e0e0e8', textSecondary: '#8888a0' },
  netrunner:  { label: 'Netrunner',   primary: '#00ff41', secondary: '#19f3f7', accent: '#88ff88', bgDeep: '#0a0f0a', bgBase: '#0d1a0d', bgSurface: '#142814', bgElevated: '#1e3d1e', textPrimary: '#c0ffc0', textSecondary: '#608860' },
  corporate:  { label: 'Corporate',   primary: '#4488ff', secondary: '#cccccc', accent: '#ffaa00', bgDeep: '#0a0a14', bgBase: '#101020', bgSurface: '#181830', bgElevated: '#222245', textPrimary: '#d0d0e8', textSecondary: '#7878a0' },
  arasaka:    { label: 'Arasaka',     primary: '#ff2020', secondary: '#ffffff', accent: '#ff6666', bgDeep: '#0a0000', bgBase: '#1a0808', bgSurface: '#2a1010', bgElevated: '#3a1818', textPrimary: '#f0d0d0', textSecondary: '#a06060' },
  street:     { label: 'Street',      primary: '#ff6600', secondary: '#ffcc00', accent: '#ff9933', bgDeep: '#0f0a05', bgBase: '#1a1408', bgSurface: '#2a2010', bgElevated: '#3a2c18', textPrimary: '#e8d8c0', textSecondary: '#a08860' },
  chrome:     { label: 'Chrome',      primary: '#c0c0c0', secondary: '#e0e0e0', accent: '#ffffff', bgDeep: '#080808', bgBase: '#141414', bgSurface: '#1e1e1e', bgElevated: '#2a2a2a', textPrimary: '#e0e0e0', textSecondary: '#888888' },
  neon:       { label: 'Neon',        primary: '#ff00ff', secondary: '#00ffff', accent: '#ff66ff', bgDeep: '#0a0014', bgBase: '#140028', bgSurface: '#1e0040', bgElevated: '#2a0058', textPrimary: '#e0c0f0', textSecondary: '#8860a8' },
  traumaTeam: { label: 'Trauma Team', primary: '#ff3366', secondary: '#ffffff', accent: '#ff6699', bgDeep: '#0a0008', bgBase: '#1a0010', bgSurface: '#2a0820', bgElevated: '#3a1030', textPrimary: '#f0d0d8', textSecondary: '#a06878' },
});

// ─── Data Shard Presets (Sprint 4.6) ───
// Full bundles: theme, security defaults, failure mode, boot config, placeholder content templates.
// GMs can customize after applying. Applied via DataShardService.applyPreset().

export const SHARD_PRESETS = Object.freeze({
  'corporate-dossier': {
    label: 'Corporate Dossier',
    icon: 'fas fa-building',
    theme: {
      accent: '#ff0033', accentSecondary: '#ffcc00', headerBg: '#1a0000',
      iconBg: 'rgba(255,0,51,0.08)', iconColor: '#ff0033',
      watermarkIcon: 'fas fa-building', footerText: 'CORPORATE // CLASSIFIED',
      colorTemp: 'cold',
    },
    security: { encrypted: true, encryptionType: 'BLACK_ICE', encryptionDC: 20, failureMode: 'damage', maxHackAttempts: 3 },
    boot: {
      enabled: true, iconMode: 'fa', faIcon: 'fas fa-building',
      title: 'Arasaka Corporation', subtitle: 'Secure Data Terminal // Access Level: Restricted',
      progressLabel: 'Authenticating credentials...', speed: 'normal',
      animationStyle: 'holographic-snap',
      logLines: ['ARASAKA-NET handshake ........ VERIFIED', 'Credential validation ........ AUTHORIZED', 'BLACK_ICE countermeasure ...... ARMED', 'Loading secure payload ...'],
    },
    placeholderContent: ['dossier'],
  },
  'black-market': {
    label: 'Black Market Data Dump',
    icon: 'fas fa-skull-crossbones',
    theme: {
      accent: '#c0c0c0', accentSecondary: '#19f3f7', headerBg: '#0a0a0a',
      iconBg: 'rgba(192,192,192,0.08)', iconColor: '#c0c0c0',
      watermarkIcon: 'fas fa-skull-crossbones', footerText: 'UNTRACEABLE // NO REFUNDS',
      colorTemp: 'cold',
    },
    security: { encrypted: true, encryptionType: 'ICE', encryptionDC: 15, failureMode: 'lockout', maxHackAttempts: 3 },
    boot: {
      enabled: true, iconMode: 'fa', faIcon: 'fas fa-skull-crossbones',
      title: 'DATA DUMP', subtitle: 'Origin: UNKNOWN // Seller: ANONYMOUS',
      progressLabel: 'Scanning for countermeasures...', speed: 'normal',
      animationStyle: 'scan-sweep',
      logLines: ['Verifying chip integrity ...... OK', 'Scanning for trackers ......... CLEAN', 'ICE signature detected ........ CAUTION', 'Loading index ...'],
    },
    placeholderContent: ['message', 'message'],
  },
  'personal-memory': {
    label: 'Personal Memory Chip',
    icon: 'fas fa-brain',
    theme: {
      accent: '#e8a0ff', accentSecondary: '#ffddaa', headerBg: '#1a0a20',
      iconBg: 'rgba(232,160,255,0.08)', iconColor: '#e8a0ff',
      watermarkIcon: 'fas fa-brain', footerText: 'PERSONAL // MEMORY ENGRAM',
      colorTemp: 'warm',
    },
    security: { encrypted: false, encryptionType: 'ICE', encryptionDC: 10, failureMode: 'nothing', maxHackAttempts: 5 },
    boot: {
      enabled: true, iconMode: 'fa', faIcon: 'fas fa-brain',
      title: 'MEMORY CHIP', subtitle: 'Neural Recording // Personal Archive',
      progressLabel: 'Reconstructing memory stream...', speed: 'dramatic',
      animationStyle: 'warm-dissolve',
      logLines: ['Memory buffer allocated ....... OK', 'Neural pattern detected ....... VALID', 'Reconstructing timeline ....... 100%', 'Stream ready.'],
    },
    placeholderContent: ['avlog'],
  },
  'military-intel': {
    label: 'Military Intelligence',
    icon: 'fas fa-crosshairs',
    theme: {
      accent: '#44aa44', accentSecondary: '#88cc88', headerBg: '#0a1a0a',
      iconBg: 'rgba(68,170,68,0.08)', iconColor: '#44aa44',
      watermarkIcon: 'fas fa-crosshairs', footerText: 'CLASSIFIED // NUSA MILINET',
      colorTemp: 'cold',
    },
    security: { encrypted: true, encryptionType: 'RED_ICE', encryptionDC: 25, failureMode: 'destroy', maxHackAttempts: 2 },
    boot: {
      enabled: true, iconMode: 'fa', faIcon: 'fas fa-crosshairs',
      title: 'MILINET TERMINAL', subtitle: 'Military Intelligence Network // TOP SECRET',
      progressLabel: 'Verifying clearance...', speed: 'fast',
      animationStyle: 'instant-dump',
      logLines: ['MILINET AUTH .................. PENDING', 'Clearance level ............... UNKNOWN', 'RED_ICE deployed .............. LETHAL', 'ACCESS RESTRICTED.'],
    },
    placeholderContent: ['location', 'dossier'],
  },
  'media-leak': {
    label: 'Media Leak',
    icon: 'fas fa-tower-broadcast',
    theme: {
      accent: '#4488ff', accentSecondary: '#ffffff', headerBg: '#0a0a1a',
      iconBg: 'rgba(68,136,255,0.08)', iconColor: '#4488ff',
      watermarkIcon: 'fas fa-tower-broadcast', footerText: 'LEAKED // SOURCE PROTECTED',
      colorTemp: 'neutral',
    },
    security: { encrypted: true, encryptionType: 'ICE', encryptionDC: 15, failureMode: 'lockout', maxHackAttempts: 3 },
    boot: {
      enabled: true, iconMode: 'fa', faIcon: 'fas fa-tower-broadcast',
      title: 'MEDIA LEAK', subtitle: 'Unverified Source // Handle With Care',
      progressLabel: 'Decrypting broadcast...', speed: 'normal',
      animationStyle: 'camera-flash',
      logLines: ['Source fingerprint ............ REDACTED', 'Broadcast origin .............. SCRAMBLED', 'Payload verified .............. INTACT', 'Loading content ...'],
    },
    placeholderContent: ['message', 'avlog'],
  },
  'fixer-dead-drop': {
    label: 'Fixer Dead Drop',
    icon: 'fas fa-handshake-angle',
    theme: {
      accent: '#ff6600', accentSecondary: '#19f3f7', headerBg: '#1a0a00',
      iconBg: 'rgba(255,102,0,0.08)', iconColor: '#ff6600',
      watermarkIcon: 'fas fa-handshake-angle', footerText: 'DEAD DROP // ONE-TIME ACCESS',
      colorTemp: 'warm',
    },
    security: { encrypted: true, encryptionType: 'ICE', encryptionDC: 12, failureMode: 'lockout', maxHackAttempts: 3 },
    boot: {
      enabled: true, iconMode: 'fa', faIcon: 'fas fa-handshake-angle',
      title: 'DEAD DROP', subtitle: 'Encrypted Payload // Time Sensitive',
      progressLabel: 'Establishing secure channel...', speed: 'normal',
      animationStyle: 'neon-breathe',
      logLines: ['Dead drop located ............. FOUND', 'Payload integrity ............. GOOD', 'ICE layer ..................... STANDARD', 'Ready for extraction.'],
    },
    placeholderContent: ['eddies', 'message'],
  },
  'street-shard': {
    label: 'Street Shard',
    icon: 'fas fa-microchip',
    theme: {
      accent: '#888888', accentSecondary: '#cccccc', headerBg: '#0f0f0f',
      iconBg: 'rgba(136,136,136,0.08)', iconColor: '#888888',
      watermarkIcon: 'fas fa-microchip', footerText: 'UNBRANDED // RAW DATA',
      colorTemp: 'neutral',
    },
    security: { encrypted: false, encryptionType: 'ICE', encryptionDC: 10, failureMode: 'nothing', maxHackAttempts: 5 },
    boot: {
      enabled: true, iconMode: 'fa', faIcon: 'fas fa-microchip',
      title: 'DATA SHARD', subtitle: 'Generic Storage // No Authentication',
      progressLabel: 'Reading chip...', speed: 'fast',
      animationStyle: 'glitch-stutter',
      logLines: ['Chip detected ................. OK', 'Format: STANDARD .............. OK', 'Loading ...'],
    },
    placeholderContent: ['message'],
  },
  'netwatch-evidence': {
    label: 'NetWatch Evidence',
    icon: 'fas fa-eye',
    theme: {
      accent: '#ff8800', accentSecondary: '#4488ff', headerBg: '#0a0a1a',
      iconBg: 'rgba(255,136,0,0.08)', iconColor: '#ff8800',
      watermarkIcon: 'fas fa-eye', footerText: 'NETWATCH // EVIDENCE LOCKER',
      colorTemp: 'cold',
    },
    security: { encrypted: true, encryptionType: 'BLACK_ICE', encryptionDC: 22, failureMode: 'permanent', maxHackAttempts: 2 },
    boot: {
      enabled: true, iconMode: 'fa', faIcon: 'fas fa-eye',
      title: 'NETWATCH', subtitle: 'Evidence Archive // Tampering Will Be Prosecuted',
      progressLabel: 'Security sweep in progress...', speed: 'normal',
      animationStyle: 'authority-stamp',
      logLines: ['NetWatch AUTH node ............ ACTIVE', 'Evidence chain verified ........ SEALED', 'BLACK_ICE defense ............. ARMED', 'WARNING: Access is logged.'],
    },
    placeholderContent: ['dossier', 'message'],
  },
  'blank': {
    label: 'Blank / Custom',
    icon: 'fas fa-microchip',
    theme: {
      accent: 'var(--ncm-color-primary)', accentSecondary: 'var(--ncm-color-secondary)', headerBg: 'var(--ncm-bg-surface)',
      iconBg: 'rgba(246,82,97,0.08)', iconColor: 'var(--ncm-color-primary)',
      watermarkIcon: 'fas fa-microchip', footerText: 'DATA SHARD',
      colorTemp: 'neutral',
    },
    security: { encrypted: false, encryptionType: 'ICE', encryptionDC: 15, failureMode: 'lockout', maxHackAttempts: 3 },
    boot: {
      enabled: true, iconMode: 'fa', faIcon: 'fas fa-microchip',
      title: 'DATA SHARD', subtitle: 'Reading chip contents...',
      progressLabel: 'Loading data...', speed: 'normal',
      animationStyle: 'standard-fade',
      logLines: ['Chip interface ................ OK', 'Data integrity ................ VERIFIED', 'Loading ...'],
    },
    placeholderContent: [],
  },
});

// ─── Sound Paths ───

export const SOUND_PATHS = Object.freeze({
  'open': 'ui/open.ogg', 'close': 'ui/close.ogg', 'click': 'ui/click.ogg',
  'hover': 'ui/hover.ogg', 'keystroke': 'ui/keystroke.ogg',
  'receive': 'messages/receive.ogg', 'receive-urgent': 'messages/receive-urgent.ogg',
  'send': 'messages/send.ogg', 'queue-flush': 'messages/queue-flush.ogg',
  'connect': 'network/connect.ogg', 'disconnect': 'network/disconnect.ogg',
  'switch': 'network/switch.ogg', 'dead-zone': 'network/dead-zone.ogg',
  'hack-start': 'security/hack-start.ogg', 'hack-progress': 'security/hack-progress.ogg',
  'hack-success': 'security/hack-success.ogg', 'hack-fail': 'security/hack-fail.ogg',
  'black-ice': 'security/black-ice.ogg', 'lockout': 'security/lockout.ogg',
  'login-success': 'security/login-success.ogg', 'login-fail': 'security/login-fail.ogg',
  'key-accepted': 'security/key-accepted.ogg', 'key-rejected': 'security/key-rejected.ogg',
  'shard-insert': 'shard/insert.ogg', 'shard-decrypt': 'shard/decrypt.ogg',
  'shard-relock': 'shard/relock.ogg', 'shard-boot': 'shard/boot.ogg',
  'shard-compile': 'shard/compile.ogg', 'shard-brick': 'shard/brick.ogg',
  'shard-expire': 'shard/expire.ogg', 'eddies-claim': 'shard/eddies-claim.ogg',
  'trace-fire': 'shard/trace-fire.ogg',
  'terminal-hum': 'ambient/terminal-hum.ogg',
});

export const ESSENTIAL_EFFECTS = Object.freeze(['ncm-fade-in', 'ncm-fade-out']);

// ─── Template Paths ───

const T = `modules/${MODULE_ID}/templates`;
export const TEMPLATES = Object.freeze({
  MESSAGE_VIEWER: `${T}/message-viewer/message-viewer.hbs`,
  MESSAGE_LIST_ITEM: `${T}/message-viewer/partials/message-list-item.hbs`,
  MESSAGE_DETAIL: `${T}/message-viewer/partials/message-detail.hbs`,
  EMPTY_STATE_LIST: `${T}/message-viewer/partials/empty-state-list.hbs`,
  EMPTY_STATE_DETAIL: `${T}/message-viewer/partials/empty-state-detail.hbs`,
  MESSAGE_COMPOSER: `${T}/message-composer/message-composer.hbs`,
  CONTACT_MANAGER: `${T}/contact-manager/contact-manager.hbs`,
  GM_CONTACT_MANAGER: `${T}/gm-contact-manager/gm-contact-manager.hbs`,
  ITEM_INBOX: `${T}/item-inbox/item-inbox.hbs`,
  SECURITY_OVERLAY_NETWORK: `${T}/item-inbox/security-overlay-network.hbs`,
  SECURITY_OVERLAY_KEYITEM: `${T}/item-inbox/security-overlay-keyitem.hbs`,
  SECURITY_OVERLAY_LOGIN: `${T}/item-inbox/security-overlay-login.hbs`,
  SECURITY_OVERLAY_ENCRYPTION: `${T}/item-inbox/security-overlay-encryption.hbs`,
  HACKING_SEQUENCE: `${T}/item-inbox/hacking-sequence.hbs`,
  SHARD_BOOT_SCREEN: `${T}/item-inbox/shard-boot-screen.hbs`,
  SHARD_ENTRY_MESSAGE: `${T}/item-inbox/renderers/entry-message.hbs`,
  SHARD_ENTRY_EDDIES: `${T}/item-inbox/renderers/entry-eddies.hbs`,
  SHARD_ENTRY_DOSSIER: `${T}/item-inbox/renderers/entry-dossier.hbs`,
  SHARD_ENTRY_PAYLOAD: `${T}/item-inbox/renderers/entry-payload.hbs`,
  SHARD_ENTRY_AVLOG: `${T}/item-inbox/renderers/entry-avlog.hbs`,
  SHARD_ENTRY_LOCATION: `${T}/item-inbox/renderers/entry-location.hbs`,
  SHARD_INDEX_STRIP: `${T}/item-inbox/partials/shard-index-strip.hbs`,
  SHARD_IDENTITY_HEADER: `${T}/item-inbox/partials/shard-identity-header.hbs`,
  ITEM_INBOX_CONFIG: `${T}/item-inbox/item-inbox-config.hbs`,
  DATA_SHARD_COMPOSER: `${T}/item-inbox/data-shard-composer.hbs`,
  ADMIN_SHARD_CARD: `${T}/admin-panel/partials/shard-card.hbs`,
  NETWORK_MANAGEMENT: `${T}/network-management/network-management.hbs`,
  ADMIN_PANEL: `${T}/admin-panel/admin-panel.hbs`,
  ADMIN_NETWORK_CARD: `${T}/admin-panel/partials/network-card.hbs`,
  THEME_CUSTOMIZER: `${T}/theme-customizer/theme-customizer.hbs`,
  NETWORK_AUTH_DIALOG: `${T}/dialogs/network-auth-dialog.hbs`,
  CREATE_NETWORK_DIALOG: `${T}/dialogs/create-network.hbs`,
  DEAD_ZONE_WARNING: `${T}/dialogs/dead-zone-warning.hbs`,
  NETWORK_SELECTOR: `${T}/message-viewer/partials/network-selector.hbs`,
  PLAYER_EMAIL_SETUP: `${T}/dialogs/player-email-setup.hbs`,
  CHAT_MESSAGE_CARD: `${T}/chat/message-card.hbs`,
  CHAT_HACK_RESULT: `${T}/chat/hack-result.hbs`,
  CHAT_NETWORK_EVENT: `${T}/chat/network-event.hbs`,
  CONTACT_CARD:           `${T}/contact-manager/partials/contact-card.hbs`,
  CONTACT_LIST_ITEM:      `${T}/contact-manager/partials/contact-list-item.hbs`,
  CONTACT_TRUST_METER:    `${T}/contact-manager/partials/trust-meter.hbs`,
  CONTACT_TRUST_DETAIL: `${T}/contact-manager/partials/trust-detail.hbs`,
  CONTACT_ENCRYPTED:      `${T}/contact-manager/partials/encrypted-overlay.hbs`,
  CONTACT_FORM:          `${T}/contact-manager/partials/contact-form.hbs`,
  // Partials — Design System Components
  PARTIAL_SECTION_HEADER: `${T}/partials/section-header.hbs`,
  PARTIAL_STAT_CARD:      `${T}/partials/stat-card.hbs`,
  PARTIAL_STAT_GRID:      `${T}/partials/stat-grid.hbs`,
  PARTIAL_TAG_BADGE:      `${T}/partials/tag-badge.hbs`,
  PARTIAL_ENTITY_CARD:    `${T}/partials/entity-card.hbs`,
  PARTIAL_SIGNAL_BAR:     `${T}/partials/signal-bar.hbs`,
  PARTIAL_PROGRESS_BAR:   `${T}/partials/progress-bar.hbs`,
  PARTIAL_ALERT_PANEL:    `${T}/partials/alert-panel.hbs`,
  PARTIAL_EMPTY_STATE:    `${T}/partials/empty-state.hbs`,
  PARTIAL_ACTION_BAR:     `${T}/partials/action-bar.hbs`,
  PARTIAL_HUD_STRIP: `${T}/partials/hud-strip.hbs`,
  PARTIAL_TOAST: `${T}/partials/toast.hbs`,
  CONTACT_SHARE_DIALOG:  `${T}/contact-share/contact-share-dialog.hbs`,
  DATA_DROP_OVERLAY:     `${T}/data-drop/data-drop-overlay.hbs`,
  PARTIAL_METADATA_READOUT: `${T}/partials/metadata-readout.hbs`,
  PARTIAL_ENCRYPTED_ATTACHMENT: `${T}/partials/encrypted-attachment.hbs`,
  PARTIAL_ATTACHMENT_CHIP:      `${T}/partials/attachment-chip.hbs`,
});

// ─── Default Configs ───

export const DEFAULTS = Object.freeze({
  PLAYER_THEME: {
    preset: 'classic',
    colors: { primary: null, secondary: null, accent: null, bgDeep: null, bgBase: null, bgSurface: null, bgElevated: null, textPrimary: null, textSecondary: null },
    scanlines: true, glitchIntensity: 0.5, animationLevel: 'full', neonGlow: true,
    messageDensity: 'normal', sidebarWidth: 300, defaultSort: 'newest', showAvatars: true, wallpaper: null,
    soundEnabled: true, soundVolume: 0.5, ambientEnabled: false,
  },
  SHARD_CONFIG: {
    // ─── Identity ───
    preset: 'blank',                    // Preset key from SHARD_PRESETS
    shardName: '',                      // Display name override (empty = use item name)

    // ─── Metadata ───
    metadata: {
      creator: 'Unknown',
      network: '',
      timestamp: '',
      location: '',
      classification: '',
      custom: {},
    },

    // ─── Integrity ───
    integrity: {
      enabled: false,
      mode: 'cosmetic',                // 'cosmetic' | 'mechanical'
      maxIntegrity: 100,
      currentIntegrity: 100,
      degradePerFailure: 15,
      corruptionThreshold: 40,
      corruptionChance: 0.3,
    },

    // ─── Expiration ───
    expiration: {
      enabled: false,
      mode: 'timer',                   // 'timer' | 'calendar' | 'on-access'
      timerDuration: 172800000,        // 48 hours in ms
      calendarDate: null,
      accessCount: 1,
      triggered: false,
      triggeredAt: null,
    },

    // ─── Linked Shards ───
    linkedShards: [],

    // ─── Access Notifications ───
    notifyGM: true,
    notifyContact: false,
    notifyContactId: null,

    // ─── Boot Sequence ───
    boot: {
      enabled: true,
      iconMode: 'fa',                  // 'fa' | 'image'
      faIcon: 'fas fa-microchip',
      imageUrl: null,
      imageSize: 64,
      imageBorderRadius: 'rounded',    // 'square' | 'rounded' | 'circle'
      title: 'DATA SHARD',
      subtitle: 'Reading chip contents...',
      progressLabel: 'Loading data...',
      logLines: [
        'Chip interface ................ OK',
        'Data integrity ................ VERIFIED',
        'Loading ...',
      ],
      speed: 'normal',                 // 'fast' | 'normal' | 'dramatic'
      animationStyle: 'standard-fade', // Per-preset animation choreography
    },

    // ─── Network (replaces old requiresNetwork / requiredNetwork) ───
    network: {
      required: false,
      accessMode: 'any',               // 'any' | 'whitelist' | 'type' | 'both'
      allowedNetworks: [],
      allowedTypes: [],
      connectionMode: 'offline',       // 'offline' | 'tethered'
      signalThreshold: 40,
      signalDVModifier: true,
      signalDegradation: false,
      tracing: {
        enabled: false,
        mode: 'silent',                // 'silent' | 'warned' | 'visible'
        triggerOn: 'access',           // 'access' | 'hack-attempt' | 'hack-fail' | 'any'
        traceTarget: null,
        traceMessage: null,
        traceDelay: 0,
        revealIdentity: true,
        revealLocation: false,
        cooldown: 0,
      },
    },

    // ─── Security (existing v4.1 fields — preserved for backward compat) ───
    encrypted: false,
    encryptionType: 'ICE',
    encryptionDC: 15,
    encryptionMode: 'shard',
    allowedSkills: ['Interface'],
    skillDCs: {},
    failureMode: 'lockout',
    maxHackAttempts: 3,
    lockoutDuration: 3600000,

    // ─── Login ───
    requiresLogin: false,
    loginUsername: '',
    loginPassword: '',
    loginDisplayName: '',
    maxLoginAttempts: 3,

    // ─── Key Item ───
    requiresKeyItem: false,
    keyItemName: null,
    keyItemId: null,
    keyItemTag: null,
    keyItemDisplayName: '',
    keyItemIcon: 'fa-id-card',
    keyItemBypassLogin: true,
    keyItemBypassEncryption: false,
    keyItemConsumeOnUse: false,

    // ─── Layer Hack Security (network/keyitem/login bypass attempts) ───
    layerSecurity: {
      enabled: false,                    // When false, layer hacks have no consequence
      maxAttempts: 3,                    // Max hack attempts across all layers before consequence
      failureMode: 'lockout',           // 'nothing' | 'lockout' | 'permanent' | 'damage' | 'destroy'
      lockoutDuration: 3600000,         // 1 hour default lockout for layer hacks
      degradeOnFail: true,              // Degrade shard integrity on failed layer hack
    },

    // ─── Legacy compat (mapped to network.required internally) ───
    requiresNetwork: false,
    requiredNetwork: null,

    // ─── Display ───
    theme: 'classic',
    singleMessage: false,
  },
  SHARD_STATE: {
    decrypted: false,
    sessions: {},
    destroyed: false,
    bootPlayed: false,                 // Whether boot sequence has been shown this session
    firstAccessedAt: null,             // For expiration timer start
    accessCount: 0,                    // For on-access expiration mode
  },
  ACTOR_SESSION: { loggedIn: false, keyItemUsed: false, hackAttempts: 0, lockoutUntil: null, loginAttempts: 0, hackedLayers: [], layerHackAttempts: {}, layerLockoutUntil: null },
  SCENE_NETWORK: { networkAvailability: {}, defaultNetwork: 'CITINET', deadZone: false },
  CORE_NETWORKS: [
    { id: 'CITINET', name: 'CitiNet', type: 'PUBLIC', isCore: true, availability: { global: true, scenes: [] }, signalStrength: 75, reliability: 90, security: { level: 'LOW', requiresAuth: false }, effects: { messageDelay: 0, traced: false, anonymity: false, canRoute: true, restrictedAccess: false, allowedRecipientNetworks: [] }, theme: { color: '#19f3f7', icon: 'fa-wifi', glitchIntensity: 0.1 }, description: 'Night City public network' },
    { id: 'CORPNET', name: 'CorpNet', type: 'CORPORATE', isCore: true, availability: { global: false, scenes: [] }, signalStrength: 95, reliability: 99, security: { level: 'HIGH', requiresAuth: true }, effects: { messageDelay: 0, traced: true, anonymity: false, canRoute: true, restrictedAccess: true, allowedRecipientNetworks: ['CORPNET', 'CITINET'] }, theme: { color: '#4488ff', icon: 'fa-building', glitchIntensity: 0 }, description: 'Corporate communications' },
    { id: 'DARKNET', name: 'DarkNet', type: 'UNDERGROUND', isCore: true, availability: { global: false, scenes: [] }, signalStrength: 50, reliability: 70, security: { level: 'NONE', requiresAuth: false }, effects: { messageDelay: 500, traced: false, anonymity: true, canRoute: true, restrictedAccess: false, allowedRecipientNetworks: [] }, theme: { color: '#00ff41', icon: 'fa-mask', glitchIntensity: 0.4 }, description: 'Underground network' },
    { id: 'GOVNET', name: 'GovNet', type: 'GOVERNMENT', isCore: true, availability: { global: false, scenes: [] }, signalStrength: 100, reliability: 99, security: { level: 'MAXIMUM', requiresAuth: true }, effects: { messageDelay: 0, traced: true, anonymity: false, canRoute: false, restrictedAccess: true, allowedRecipientNetworks: ['GOVNET'] }, theme: { color: '#ff6600', icon: 'fa-shield-halved', glitchIntensity: 0 }, description: 'Government secure comms' },
    { id: 'DATA_POOL', name: 'Data Pool', type: 'PUBLIC', isCore: true, availability: { global: true, scenes: [] }, signalStrength: 60, reliability: 80, security: { level: 'NONE', requiresAuth: false }, effects: { messageDelay: 200, traced: false, anonymity: false, canRoute: true, restrictedAccess: false, allowedRecipientNetworks: [] }, theme: { color: '#f7c948', icon: 'fa-database', glitchIntensity: 0.2 }, description: 'Public data sharing' },
  ],
});

export const COLOR_VAR_MAP = Object.freeze({
  primary: '--ncm-primary', secondary: '--ncm-secondary', accent: '--ncm-accent',
  bgDeep: '--ncm-bg-deep', bgBase: '--ncm-bg-base', bgSurface: '--ncm-bg-surface',
  bgElevated: '--ncm-bg-elevated', textPrimary: '--ncm-text-primary', textSecondary: '--ncm-text-secondary',
});
