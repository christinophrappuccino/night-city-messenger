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
  'shard-relock': 'shard/relock.ogg', 'terminal-hum': 'ambient/terminal-hum.ogg',
});

export const ESSENTIAL_EFFECTS = Object.freeze(['ncm-fade-in', 'ncm-fade-out']);

// ─── Template Paths ───

const T = `modules/${MODULE_ID}/templates`;
export const TEMPLATES = Object.freeze({
  MESSAGE_VIEWER: `${T}/message-viewer/message-viewer.hbs`,
  MESSAGE_LIST_ITEM: `${T}/message-viewer/message-list-item.hbs`,
  MESSAGE_DETAIL: `${T}/message-viewer/message-detail.hbs`,
  MESSAGE_COMPOSER: `${T}/message-composer/message-composer.hbs`,
  CONTACT_MANAGER: `${T}/contact-manager/contact-manager.hbs`,
  GM_CONTACT_MANAGER: `${T}/gm-contact-manager/gm-contact-manager.hbs`,
  ITEM_INBOX: `${T}/item-inbox/item-inbox.hbs`,
  SECURITY_OVERLAY_NETWORK: `${T}/item-inbox/security-overlay-network.hbs`,
  SECURITY_OVERLAY_KEYITEM: `${T}/item-inbox/security-overlay-keyitem.hbs`,
  SECURITY_OVERLAY_LOGIN: `${T}/item-inbox/security-overlay-login.hbs`,
  SECURITY_OVERLAY_ENCRYPTION: `${T}/item-inbox/security-overlay-encryption.hbs`,
  HACKING_SEQUENCE: `${T}/item-inbox/hacking-sequence.hbs`,
  NETWORK_MANAGEMENT: `${T}/network-management/network-management.hbs`,
  ADMIN_PANEL: `${T}/admin-panel/admin-panel.hbs`,
  THEME_CUSTOMIZER: `${T}/theme-customizer/theme-customizer.hbs`,
  NETWORK_AUTH_DIALOG: `${T}/dialogs/network-auth-dialog.hbs`,
  PLAYER_EMAIL_SETUP: `${T}/dialogs/player-email-setup.hbs`,
  CHAT_MESSAGE_CARD: `${T}/chat/message-card.hbs`,
  CHAT_HACK_RESULT: `${T}/chat/hack-result.hbs`,
  CHAT_NETWORK_EVENT: `${T}/chat/network-event.hbs`,
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
    encrypted: false, encryptionType: 'ICE', encryptionDC: 15, encryptionMode: 'shard',
    allowedSkills: ['Interface'], skillDCs: {}, failureMode: 'lockout',
    maxHackAttempts: 3, lockoutDuration: 3600000,
    requiresLogin: false, loginUsername: '', loginPassword: '', loginDisplayName: '', maxLoginAttempts: 3,
    requiresKeyItem: false, keyItemName: null, keyItemId: null, keyItemTag: null,
    keyItemDisplayName: '', keyItemIcon: 'fa-id-card', keyItemBypassLogin: true,
    keyItemBypassEncryption: false, keyItemConsumeOnUse: false,
    requiresNetwork: false, requiredNetwork: null, theme: 'classic', singleMessage: false,
  },
  SHARD_STATE: { decrypted: false, sessions: {} },
  ACTOR_SESSION: { loggedIn: false, keyItemUsed: false, hackAttempts: 0, lockoutUntil: null, loginAttempts: 0 },
  SCENE_NETWORK: { networkAvailability: {}, defaultNetwork: 'CITINET', deadZone: false },
  CORE_NETWORKS: [
    { id: 'CITINET', name: 'CitiNet', type: 'PUBLIC', isCore: true, availability: { global: true, scenes: [] }, signalStrength: 75, reliability: 90, security: { level: 'LOW', requiresAuth: false }, effects: { messageDelay: 0, traced: false, anonymity: false, canRoute: true }, theme: { color: '#19f3f7', icon: 'fa-wifi', glitchIntensity: 0.1 }, description: 'Night City public network' },
    { id: 'CORPNET', name: 'CorpNet', type: 'CORPORATE', isCore: true, availability: { global: false, scenes: [] }, signalStrength: 95, reliability: 99, security: { level: 'HIGH', requiresAuth: true }, effects: { messageDelay: 0, traced: true, anonymity: false, canRoute: true }, theme: { color: '#4488ff', icon: 'fa-building', glitchIntensity: 0 }, description: 'Corporate communications' },
    { id: 'DARKNET', name: 'DarkNet', type: 'UNDERGROUND', isCore: true, availability: { global: false, scenes: [] }, signalStrength: 50, reliability: 70, security: { level: 'NONE', requiresAuth: false }, effects: { messageDelay: 500, traced: false, anonymity: true, canRoute: true }, theme: { color: '#00ff41', icon: 'fa-mask', glitchIntensity: 0.4 }, description: 'Underground network' },
    { id: 'GOVNET', name: 'GovNet', type: 'GOVERNMENT', isCore: true, availability: { global: false, scenes: [] }, signalStrength: 100, reliability: 99, security: { level: 'MAXIMUM', requiresAuth: true }, effects: { messageDelay: 0, traced: true, anonymity: false, canRoute: false }, theme: { color: '#ff6600', icon: 'fa-shield-halved', glitchIntensity: 0 }, description: 'Government secure comms' },
    { id: 'DATA_POOL', name: 'Data Pool', type: 'PUBLIC', isCore: true, availability: { global: true, scenes: [] }, signalStrength: 60, reliability: 80, security: { level: 'NONE', requiresAuth: false }, effects: { messageDelay: 200, traced: false, anonymity: false, canRoute: true }, theme: { color: '#f7c948', icon: 'fa-database', glitchIntensity: 0.2 }, description: 'Public data sharing' },
  ],
});

export const COLOR_VAR_MAP = Object.freeze({
  primary: '--ncm-primary', secondary: '--ncm-secondary', accent: '--ncm-accent',
  bgDeep: '--ncm-bg-deep', bgBase: '--ncm-bg-base', bgSurface: '--ncm-bg-surface',
  bgElevated: '--ncm-bg-elevated', textPrimary: '--ncm-text-primary', textSecondary: '--ncm-text-secondary',
});
