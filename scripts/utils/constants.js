/**
 * Module Constants
 * @file scripts/utils/constants.js
 * @module night-city-messenger
 * @description Single source of truth for all module constants
 */

export const MODULE_ID = 'night-city-messenger';
/**
 * The module's ORIGINAL id (v1.0 shipped as `cyberpunkred-messenger`). Exists
 * solely so NamespaceMigration can find and move a world's old flags/settings.
 * Never write new data under it, and never use it anywhere else.
 */
export const LEGACY_MODULE_ID = 'cyberpunkred-messenger';
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
  CONTACT_BLACK_ICE:      'contacts:blackIce',
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
  BLACK_ICE_DAMAGE: 'ice:damage',
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

  // ─── Terminal Expansion (sibling of Data Shard) ───
  TERMINAL_CREATED: 'terminal:created',
  TERMINAL_LOGIN_SUCCESS: 'terminal:loginSuccess',
  TERMINAL_LOGIN_FAILURE: 'terminal:loginFailure',
  TERMINAL_RELOCKED: 'terminal:relocked',
  TERMINAL_STATE_CHANGED: 'terminal:stateChanged',
  TERMINAL_EXFIL: 'terminal:exfil',

  CONTACT_UPDATED: 'contact:updated',
  // Contact groups — mirrored to Foundry hooks by IntegrationBridge.
  GROUP_CREATED: 'groups:created',   // { scope:'actor'|'master', actorId?, group }
  GROUP_UPDATED: 'groups:updated',   // { scope, actorId?, group }
  GROUP_DELETED: 'groups:deleted',   // { scope, actorId?, groupId }
  GROUP_PUSHED:  'groups:pushed',    // { groupId, targetActorId, shared, failed }
  SCHEDULE_UPDATED: 'schedule:updated',

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
  LOG_RELAY:             'log:relay',
  SHARD_CONVERT_REQUEST: 'shard:convertRequest',
  SHARD_CONVERT_RESULT:  'shard:convertResult',
  SHARD_UNCONVERT_REQUEST: 'shard:unconvertRequest',
  SHARD_UNCONVERT_RESULT:  'shard:unconvertResult',
  ANON_TRACE_REQUEST:      'anon:traceRequest',
  TERMINAL_STATE_CHANGED:  'terminal:stateChanged',
  TERMINAL_EXFIL_REQUEST:  'terminal:exfilRequest',
  TERMINAL_NET_REQUEST:    'terminal:netRequest',
  // Player→GM relay for terminal session-state writes (login / account switch /
  // logout) — players can't update the GM-owned world item. No RESULT op: the
  // flag write syncs back and the viewer re-renders off its updateItem hook.
  TERMINAL_SESSION_REQUEST: 'terminal:sessionRequest',
  TERMINAL_EXFIL_RESULT:   'terminal:exfilResult',
  // Banking siphon — player→GM relay. Carries outcome 'success' (persist the
  // account drain to its GM-owned journal page) or 'fail' (trace + GM alert).
  BANK_SIPHON_REQUEST:     'bank:siphonRequest',
  // Generic typed-content write relay (eddies claim / credential crack / any
  // future contentData mutation) — { messageId, newContentData, gmToast }.
  CONTENT_UPDATE_REQUEST:  'content:updateRequest',
  // Payload execution relay (player→GM) — the roll runs client-side, but the
  // module-native effect (unseal host files / clear lockouts / scan / jam) +
  // the payload state write are GM-owned. Carries { messageId, actorId,
  // outcome:'success'|'fail'|'kill' }.
  PAYLOAD_EFFECT_REQUEST:  'payload:effectRequest',
  // Player→GM relay for UPLOAD/PLANT — a player rolls the FORGE check client-side
  // then relays the resulting resident for the GM to install on the GM-owned
  // terminal (residents live in terminalState). Carries { itemUuid, resident }.
  TERMINAL_RESIDENT_REQUEST: 'terminal:residentRequest',
  // Player→GM relay for a trace event — the log + heat are GM-owned world
  // settings, so a player who trips a trace relays the record to the GM.
  TRACE_REQUEST: 'trace:request',
  // Player→GM: a price a player wants on a shard THEY made (Shard Encoder,
  // pricing mode 'propose'). The GM approves / counters / denies; only then is
  // system.price.market written, and only by the GM who owns that call.
  SHARD_PRICE_REQUEST: 'shard:priceRequest',
  SHARD_PRICE_RESULT:  'shard:priceResult',
  // Netrunning Tier C (design §5, `hackResolution: 'gm'`) — the action does NOT
  // auto-roll; the player asks the GM to adjudicate pass/fail at the table.
  // REQUEST { requestId, userId, payload } → the GM's NetAdjudicator prompt →
  // RESULT { requestId, userId, choiceId|cancelled }. CANCEL lets the waiting
  // player withdraw (closes the GM prompt, nothing resolves).
  NET_RESOLVE_REQUEST: 'net:resolveRequest',
  NET_RESOLVE_RESULT:  'net:resolveResult',
  NET_RESOLVE_CANCEL:  'net:resolveCancel',
  // GM→player: the GM docked/restored their adjudicator ("RUN THE NET"). The
  // waiting player's console mirrors it — docks to a NETRUN-IN-PROGRESS chip
  // when the GM steps into the run, restores when the GM comes back to call it —
  // so the two screens stay in sync instead of the player guessing. Carries
  // { requestId, userId, minimized }.
  NET_RESOLVE_STATE:   'net:resolveState',
  // GM→everyone: a forced (escalation) lockout. SecurityService state is
  // CLIENT-LOCAL — a GM-side forceLockout alone never reaches the player's
  // client, which let a locked-out player just log back in. Carries
  // { actorId, targets[], durationMs, label, reason }; every client applies it
  // locally, and the client whose user owns the actor toasts + kicks any open
  // terminal/shard session on the locked target.
  SECURITY_LOCKOUT: 'security:forceLockout',
  // GM→specific users: a targeted security toast (e.g. "BLACK ICE fights back")
  // for events applied on another client. { userIds[], kind, data } — the
  // receiving client renders via NotificationService.
  SECURITY_NOTIFY: 'security:notify',
  // Player→GM: a shard-integrity write. The integrity number lives on the item
  // and entry damage on the GM-owned shard journal, so a player's failed breach,
  // reconstruct, repair or salvage relays here. { op, itemUuid, ... } — ops:
  // 'degrade' | 'entry' | 'repair' | 'salvage' | 'salvageSpent'.
  SHARD_INTEGRITY_REQUEST: 'shard:integrityRequest',
  // Player→GM: a shard STATE write — the decrypted flag, an actor's session
  // (attempts / lockouts / login / key item), a per-entry decrypt, or the
  // self-destruct. All of it lives on the ITEM (or the GM-owned journal), so a
  // player hacking a WORLD shard they do not own — a shard that arrived as a
  // message attachment — relays here instead of throwing on item.update.
  // { op, itemUuid, userId, ... } — ops: 'decrypt' | 'session' | 'decryptPage' | 'destroy'.
  SHARD_STATE_REQUEST: 'shard:stateRequest',
});

// ─── Netrunning binding (design §5) ───

/** hackResolution tiers — HOW a gated hack/upload action resolves. */
export const HACK_RESOLUTION_MODES = Object.freeze({
  AUTO: 'auto',       // roll it (current behavior) — an abstraction of netrunning
  FLAGGED: 'flagged', // roll it, but announce the NET-action shape on a GM card
  GM: 'gm',           // don't roll — the table runs the NET, the GM calls pass/fail
});

/**
 * The RED NET-action each module action is an abstraction OF (§5's `netAction`
 * vocabulary). Keys are the `action` strings the flows already pass to
 * fireTrace/logSuccess (plus resident effectTypes), so TraceService can derive
 * the verb centrally with zero call-site churn. Unknown actions → no verb.
 */
export const NET_ACTION_VERBS = Object.freeze({
  // manipulation / forgery / system control
  upload: 'Control', plant: 'Control', siphon: 'Control', camera: 'Control',
  jammer: 'Control', exfil: 'Control', claim: 'Control',
  // breaking security
  crack: 'Backdoor', unlock: 'Backdoor', declassify: 'Backdoor', decrypt: 'Backdoor',
  forgeAccount: 'Backdoor', skeletonKey: 'Backdoor', icebreaker: 'Backdoor', 'net-join': 'Backdoor',
  // reading / identifying
  analyze: 'Eye-Dee', scanner: 'Eye-Dee', keylog: 'Scanner',
  // destructive payloads
  malware: 'Virus', deploy: 'Virus', wipe: 'Virus', logicBomb: 'Virus',
  deployICE: 'Black ICE',
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
  // Phase 2 — shared content renderers (design doc §8c)
  SPREADSHEET: 'spreadsheet', CALENDAR: 'calendar', SYSLOG: 'syslog',
  CREDENTIALS: 'credentials', BANKING: 'banking',
  // Phase 2 wave 3 — §8c continued
  GALLERY: 'gallery', DOCUMENT: 'document', CHATLOG: 'chatlog',
  // Phase 2 wave 4 — §8c catalog complete (AUDIO/VIDEO ride AVLOG)
  RECORD: 'record', SCHEMATIC: 'schematic', NOTE: 'note', MALWARE: 'malware',
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

// Lookup: normalized skill name → canonical SKILL_MAP key. Lets free-text
// config ("Electronics/SecurityTech", "basictech") resolve to the proper CPR
// name on save so stored data matches actor skill Items.
const _SKILL_CANON = new Map(
  Object.keys(SKILL_MAP).map(k => [k.toLowerCase().replace(/[\s_/\\&.-]+/g, ''), k])
);

/**
 * Canonicalize a typed skill name to its proper CPR display name (with spaces),
 * matching space/punctuation-insensitively. Returns the trimmed input unchanged
 * when it isn't a known skill (e.g. "Interface" role ability, custom skills).
 * @param {string} name
 * @returns {string}
 */
export function canonicalizeSkillName(name) {
  if (!name) return name;
  const trimmed = String(name).trim();
  const key = trimmed.toLowerCase().replace(/[\s_/\\&.-]+/g, '');
  return _SKILL_CANON.get(key) ?? trimmed;
}

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
  classic:     { label: 'Night City Standard', primary: '#F65261', secondary: '#19f3f7', accent: '#f7c948', bgDeep: '#0a0a0f', bgBase: '#12121a', bgSurface: '#1a1a2e', bgElevated: '#252540', textPrimary: '#e0e0e8', textSecondary: '#8888a0', fontDisplay: 'rajdhani', fontMono: 'sharetechmono', fontTitle: 'orbitron', textScale: 100 },
  netrunner:   { label: 'Netrunner',           primary: '#00ff41', secondary: '#40e8d0', accent: '#88ff88', bgDeep: '#030d03', bgBase: '#0a1a0a', bgSurface: '#0f2a12', bgElevated: '#183a1c', textPrimary: '#b8ffb8', textSecondary: '#5a9a5e', fontDisplay: 'chakrapetch', fontMono: 'firacode', fontTitle: 'electrolize', textScale: 100 },
  arasaka:     { label: 'Arasaka',             primary: '#e82030', secondary: '#f0f0f0', accent: '#ff4444', bgDeep: '#080000', bgBase: '#140404', bgSurface: '#220a0a', bgElevated: '#301010', textPrimary: '#f0d8d8', textSecondary: '#a06868', fontDisplay: 'saira', fontMono: 'ibmplexmono', fontTitle: 'michroma', textScale: 100 },
  militech:    { label: 'Militech',            primary: '#c8a832', secondary: '#88aa66', accent: '#e8c840', bgDeep: '#080a04', bgBase: '#101408', bgSurface: '#1a2010', bgElevated: '#242c18', textPrimary: '#d8dcc0', textSecondary: '#8a9068', fontDisplay: 'barlowcondensed', fontMono: 'robotomono', fontTitle: 'quantico', textScale: 100 },
  afterlife:   { label: 'Afterlife',           primary: '#e040ff', secondary: '#00e5ff', accent: '#ff66cc', bgDeep: '#08001a', bgBase: '#120030', bgSurface: '#1c0048', bgElevated: '#280060', textPrimary: '#e8d0ff', textSecondary: '#9060c0', fontDisplay: 'exo2', fontMono: 'spacemono', fontTitle: 'audiowide', textScale: 100 },
  traumaTeam:  { label: 'Trauma Team',         primary: '#ff2255', secondary: '#ffffff', accent: '#ff6690', bgDeep: '#0a0004', bgBase: '#180810', bgSurface: '#281018', bgElevated: '#381820', textPrimary: '#f8e0e8', textSecondary: '#b07080', fontDisplay: 'play', fontMono: 'sourcecodepro', fontTitle: 'orbitron', textScale: 100 },
  combatZone:  { label: 'Combat Zone',         primary: '#ff6a00', secondary: '#ffcc00', accent: '#ff9933', bgDeep: '#0c0804', bgBase: '#1a1208', bgSurface: '#281c0c', bgElevated: '#382814', textPrimary: '#e8d8c0', textSecondary: '#a08858', fontDisplay: 'teko', fontMono: 'vt323', fontTitle: 'blackopsone', textScale: 100 },
  chrome:      { label: 'Chrome',              primary: '#c0c0c0', secondary: '#e8e8e8', accent: '#ffffff', bgDeep: '#060606', bgBase: '#0e0e0e', bgSurface: '#181818', bgElevated: '#242424', textPrimary: '#e0e0e0', textSecondary: '#808080', fontDisplay: 'jura', fontMono: 'jetbrains', fontTitle: 'michroma', textScale: 100 },
  blackwall:   { label: 'Blackwall',           primary: '#cc2200', secondary: '#ff4433', accent: '#ff6644', bgDeep: '#0a0200', bgBase: '#140600', bgSurface: '#200c04', bgElevated: '#2c1408', textPrimary: '#f0d8cc', textSecondary: '#a06848', fontDisplay: 'oxanium', fontMono: 'firacode', fontTitle: 'aldrich', textScale: 100 },
  kiroshi:     { label: 'Kiroshi',             primary: '#2E90FA', secondary: '#F0C55B', accent: '#60b0ff', bgDeep: '#040810', bgBase: '#0a1020', bgSurface: '#101830', bgElevated: '#182240', textPrimary: '#d0e0f8', textSecondary: '#6888b0', fontDisplay: 'exo2', fontMono: 'jetbrains', fontTitle: 'electrolize', textScale: 100 },
  kawaii:      { label: 'Kawaii',              primary: '#ff88b4', secondary: '#b8a0ff', accent: '#80e8c8', bgDeep: '#0a0610', bgBase: '#140e1c', bgSurface: '#1e1628', bgElevated: '#2a2036', textPrimary: '#f0e0f0', textSecondary: '#a088b0', fontDisplay: 'play', fontMono: 'sourcecodepro', fontTitle: 'oxanium', textScale: 100 },
  tygerClaws:  { label: 'Tyger Claws',         primary: '#e8a820', secondary: '#cc2244', accent: '#ffcc44', bgDeep: '#0a0804', bgBase: '#141008', bgSurface: '#201a0c', bgElevated: '#2c2414', textPrimary: '#f0e0c8', textSecondary: '#a89060', fontDisplay: 'chakrapetch', fontMono: 'sharetechmono', fontTitle: 'audiowide', textScale: 100 },
});

// ─── Data Shard Presets (Sprint 4.6) ───
// Full bundles: theme, security defaults, failure mode, boot config, placeholder content templates.
// GMs can customize after applying. Applied via DataShardService.applyPreset().

export const SHARD_PRESETS = Object.freeze({
  'corporate-dossier': {
    label: 'Corporate Dossier',
    palette: { primary: '#aa1010', secondary: '#ee3030', accent: '#e0b040', bgDeep: '#0a0606', bgBase: '#0e0808', bgSurface: '#120a0a', bgElevated: '#1a0e0e', textPrimary: '#f5eee8', textSecondary: '#c0a090', textMuted: '#887060', border: '#3a1515' },
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
    palette: { primary: '#606878', secondary: '#c0c8d8', accent: '#00e5ff', bgDeep: '#0c0d0e', bgBase: '#10111a', bgSurface: '#14161e', bgElevated: '#1c1e28', textPrimary: '#eef0f5', textSecondary: '#a0a8bb', textMuted: '#606878', border: '#353840' },
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
    palette: { primary: '#d09040', secondary: '#f0b860', accent: '#e0a0a0', bgDeep: '#0f0c08', bgBase: '#120e08', bgSurface: '#15120a', bgElevated: '#1e1a10', textPrimary: '#f8f0e0', textSecondary: '#c8a878', textMuted: '#808090', border: '#3a2a18' },
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
    palette: { primary: '#4a7a2a', secondary: '#80cc50', accent: '#e0b040', bgDeep: '#080a08', bgBase: '#0a0d08', bgSurface: '#0d100a', bgElevated: '#141a0e', textPrimary: '#e0f0d0', textSecondary: '#90bb60', textMuted: '#608090', border: '#2a3a20' },
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
    palette: { primary: '#2a6acc', secondary: '#60b0ff', accent: '#ff5050', bgDeep: '#08090f', bgBase: '#0a0c14', bgSurface: '#0e1018', bgElevated: '#141820', textPrimary: '#e8f0f8', textSecondary: '#90b0dd', textMuted: '#607898', border: '#1a2a4a' },
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
    palette: { primary: '#d040e0', secondary: '#e070ff', accent: '#ff60b0', bgDeep: '#0c080f', bgBase: '#0e0a12', bgSurface: '#120e18', bgElevated: '#1a1422', textPrimary: '#f0e0f8', textSecondary: '#bb90cc', textMuted: '#7050a0', border: '#3a2050' },
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
    palette: { primary: '#777777', secondary: '#b0a090', accent: '#d0a050', bgDeep: '#0c0c0c', bgBase: '#101010', bgSurface: '#141414', bgElevated: '#1c1c1c', textPrimary: '#e8e0d8', textSecondary: '#aaa8a0', textMuted: '#606060', border: '#2a2a2a' },
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
    palette: { primary: '#dd3030', secondary: '#aa88ee', accent: '#e0b040', bgDeep: '#0a080c', bgBase: '#0c0a10', bgSurface: '#10101a', bgElevated: '#181420', textPrimary: '#e8e0f0', textSecondary: '#a098cc', textMuted: '#607090', border: '#2a2040' },
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
      accent: 'var(--ncm-primary)', accentSecondary: 'var(--ncm-secondary)', headerBg: 'var(--ncm-bg-surface)',
      iconBg: 'rgba(246,82,97,0.08)', iconColor: 'var(--ncm-primary)',
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

// ─── Terminal Presets (Terminal Expansion) ───
// Parallel to SHARD_PRESETS. Each preset seeds a converted terminal's theme,
// boot/login choreography, default account-security block, and a couple of
// quick-fill accounts so an empty item becomes a playable terminal fast.
// `theme` mirrors THEME_PRESETS shape (applied scoped to .ncm-terminal-viewer).
// `loginStyle`: 'cards' (account grid) | 'crt' (tty prompt). `security` is the
// shared SECURITY_BLOCK shape used by networks/shards. `accounts` are partial
// TERMINAL_ACCOUNT seeds (merged over DEFAULTS.TERMINAL_ACCOUNT on apply).
export const TERMINAL_PRESETS = Object.freeze({
  'arasaka-workstation': {
    label: 'Arasaka Workstation', icon: 'fas fa-building', loginStyle: 'cards', soundSet: 'corp-chime',
    login: {motd: 'ARASAKA NETWORK — ALL ACTIVITY IS MONITORED',welcomeText: 'Welcome back, employee. Productivity is loyalty.'},
    screensaver: {enabled: true,idleSeconds: 180,text: 'ARASAKA',iconMode: 'boot',faIcon: '',imageUrl: '',motion: 'drift'},
    folderNames: {inbox: 'Correspondence',saved: 'Flagged',trash: 'Shredder'},
    theme: { primary: '#ff0033', secondary: '#19f3f7', accent: '#ffcc00', bgDeep: '#0a0006', bgBase: '#160008', bgSurface: '#22060e', bgElevated: '#2c0a14', textPrimary: '#f4e6ea', textSecondary: '#c79aa6', fontDisplay: 'rajdhani', fontMono: 'sharetechmono', fontTitle: 'orbitron' },
    security: { requiresAuth: true, allowPassword: true, allowSkillCheck: false, authLogic: 'any', bypassSkills: ['Interface'], bypassDC: 18, encryptionType: 'BLACK_ICE', failureMode: 'damage', maxAttempts: 3, lockoutDuration: 3600000 },
    boot: { enabled: true, title: 'ARASAKA NET', subtitle: 'Secure Workstation // Access Level: Restricted', banner: 'ARASAKA NET · WORKSTATION 7F-12', animationStyle: 'holographic-snap', speed: 'normal', logLines: ['ARASAKA-NET handshake ........ VERIFIED', 'Credential gateway .......... ONLINE', 'BLACK_ICE countermeasure .... ARMED', 'Mounting user volumes ....... OK'] },
    accounts: [
      { username: 'v_arasaka', displayName: 'Veronica A.', isAdmin: false, security: { requiresAuth: true, allowPassword: true } },
      { username: 'root', displayName: 'sysadmin', isAdmin: true, security: { requiresAuth: true, allowPassword: true, allowSkillCheck: true, authLogic: 'all', bypassSkills: ['Cryptography'], bypassDC: 20 } },
    ],
  },
  'netwatch-unit': {
    label: 'NetWatch Field Unit', icon: 'fas fa-satellite-dish', loginStyle: 'cards', soundSet: 'mil-hardline',
    login: {motd: 'CLASSIFIED SYSTEM — NETWATCH EYES ONLY',welcomeText: 'Clearance verified. Watch the Wall.'},
    screensaver: {enabled: true,idleSeconds: 120,text: 'NETWATCH',iconMode: 'boot',faIcon: '',imageUrl: '',motion: 'static'},
    folderNames: {inbox: 'Bulletins',saved: 'Casework',trash: 'Purged'},
    theme: { primary: '#4aa3ff', secondary: '#b9d8ff', accent: '#9ad0ff', bgDeep: '#04070f', bgBase: '#070d18', bgSurface: '#0b1726', bgElevated: '#102236', textPrimary: '#e6eefc', textSecondary: '#90a8c8', fontDisplay: 'exo2', fontMono: 'ibmplexmono', fontTitle: 'orbitron' },
    security: { requiresAuth: true, allowPassword: true, allowSkillCheck: true, authLogic: 'all', bypassSkills: ['Cryptography'], bypassDC: 20, encryptionType: 'BLACK_ICE', failureMode: 'lockout', maxAttempts: 3, lockoutDuration: 3600000 },
    boot: { enabled: true, title: 'NETWATCH', subtitle: 'Field Intelligence Unit // CLASSIFIED', banner: 'NETWATCH FIELD UNIT · TTY0', animationStyle: 'scan-sweep', speed: 'normal', logLines: ['NETWATCH uplink ............. SECURE', 'Clearance check ............. PENDING', 'ICE lattice ................. ACTIVE'] },
    accounts: [{ username: 'root', displayName: 'field-agent', isAdmin: true, security: { requiresAuth: true, allowPassword: true, allowSkillCheck: true, authLogic: 'all', bypassSkills: ['Cryptography'], bypassDC: 20 } }],
  },
  'streetkid-bbs': {
    label: 'Streetkid BBS', icon: 'fas fa-skull', loginStyle: 'crt', soundSet: 'street-bbs',
    login: {motd: 'no narcs. no corpos. no exceptions.',welcomeText: 'yo. the board remembers you.'},
    screensaver: {enabled: true,idleSeconds: 150,text: 'AFTERLIFE BBS',iconMode: 'boot',faIcon: '',imageUrl: '',motion: 'bounce'},
    folderNames: {inbox: 'Posts',saved: 'Pinned',trash: 'Burned'},
    theme: { primary: '#00ff41', secondary: '#19f3f7', accent: '#f7c948', bgDeep: '#040a06', bgBase: '#07120a', bgSurface: '#0c1a0f', bgElevated: '#102414', textPrimary: '#daffe4', textSecondary: '#7fae8d', fontDisplay: 'chakrapetch', fontMono: 'sharetechmono', fontTitle: 'audiowide' },
    security: { requiresAuth: false, allowPassword: false, allowSkillCheck: true, authLogic: 'any', bypassSkills: ['Interface'], bypassDC: 13, encryptionType: 'ICE', failureMode: 'lockout', maxAttempts: 5, lockoutDuration: 1800000 },
    boot: { enabled: true, title: 'AFTERLIFE BBS', subtitle: 'no narcs // no cops // no mercy', banner: 'AFTERLIFE BBS · NODE 7', animationStyle: 'glitch-stutter', speed: 'dramatic', logLines: ['Dialing node ................ CARRIER', 'Trackers .................... NONE', 'Welcome back, choom.'] },
    accounts: [
      { username: 'guest', displayName: 'guest', isAdmin: false, security: { requiresAuth: false } },
      { username: 'fixer', displayName: '???', isAdmin: true, hidden: true, security: { requiresAuth: true, allowPassword: true } },
    ],
  },
  'retro-dos': {
    label: 'Retro-DOS', icon: 'fas fa-terminal', loginStyle: 'crt', soundSet: 'street-bbs',
    login: {motd: 'C:\\\\> AUTHORIZED USERS ONLY',welcomeText: 'SESSION OK. HAVE A PRODUCTIVE DAY.'},
    screensaver: {enabled: true,idleSeconds: 90,text: 'INSERT CREDCHIP',iconMode: 'boot',faIcon: '',imageUrl: '',motion: 'bounce'},
    folderNames: {inbox: 'Mail',saved: 'Archive',trash: 'Deleted'},
    theme: { primary: '#ffb000', secondary: '#ffd070', accent: '#ff8a00', bgDeep: '#0a0700', bgBase: '#140d00', bgSurface: '#1c1300', bgElevated: '#261a00', textPrimary: '#ffe6b0', textSecondary: '#b89250', fontDisplay: 'jura', fontMono: 'spacemono', fontTitle: 'michroma' },
    security: { requiresAuth: true, allowPassword: true, allowSkillCheck: false, authLogic: 'any', bypassSkills: ['Interface'], bypassDC: 15, encryptionType: 'ICE', failureMode: 'lockout', maxAttempts: 3, lockoutDuration: 3600000 },
    boot: { enabled: true, title: 'NCDOS', subtitle: 'Night City DOS v3.30', banner: 'NCDOS · DRIVE C:', animationStyle: 'instant-dump', speed: 'fast', logLines: ['POST ........................ OK', 'Loading COMMAND.COM ......... DONE', 'C:\\>'] },
    accounts: [{ username: 'user', displayName: 'user', isAdmin: false, security: { requiresAuth: true, allowPassword: true } }],
  },
  'ripperdoc': {
    label: 'Ripperdoc PC', icon: 'fas fa-staff-snake', loginStyle: 'cards', soundSet: 'med-soft',
    login: {motd: 'PATIENT CONFIDENTIALITY IN EFFECT',welcomeText: 'Scrub in. Charts are current.'},
    screensaver: {enabled: true,idleSeconds: 200,text: 'CLINIC — RING BELL',iconMode: 'boot',faIcon: '',imageUrl: '',motion: 'static'},
    folderNames: {inbox: 'Patients',saved: 'Charts',trash: 'Disposal'},
    theme: { primary: '#e8a0ff', secondary: '#ffddaa', accent: '#ff9ecb', bgDeep: '#0c0410', bgBase: '#160a1c', bgSurface: '#200f28', bgElevated: '#2a1634', textPrimary: '#f4e2fb', textSecondary: '#b890c8', fontDisplay: 'rajdhani', fontMono: 'sourcecodepro', fontTitle: 'orbitron' },
    security: { requiresAuth: true, allowPassword: false, allowSkillCheck: false, allowKeyItem: true, authLogic: 'any', keyItemName: 'Clinic Keycard', bypassSkills: ['Interface'], bypassDC: 14, encryptionType: 'ICE', failureMode: 'lockout', maxAttempts: 3, lockoutDuration: 1800000 },
    boot: { enabled: true, title: 'RIPPERDOC OS', subtitle: 'Cyberware Clinic // Patient Records', banner: 'CLINIC TERMINAL · FRONT DESK', animationStyle: 'warm-dissolve', speed: 'normal', logLines: ['Clinic uplink ............... OK', 'Patient DB .................. MOUNTED', 'Insurance relay ............. STANDBY'] },
    accounts: [{ username: 'frontdesk', displayName: 'Front Desk', isAdmin: false, security: { requiresAuth: true, allowKeyItem: true, keyItemName: 'Clinic Keycard' } }],
  },
  'trauma-team': {
    label: 'Trauma Team Platinum', icon: 'fas fa-truck-medical', loginStyle: 'roster', soundSet: 'med-soft',
    login: {motd: 'SUBSCRIBER DATA — PLATINUM TIER PROTECTED',welcomeText: 'Dispatch link secure. Fly safe.'},
    screensaver: {enabled: true,idleSeconds: 120,text: 'TRAUMA TEAM',iconMode: 'boot',faIcon: '',imageUrl: '',motion: 'drift'},
    folderNames: {inbox: 'Dispatches',saved: 'Priority',trash: 'Closed'},
    theme: { primary: '#ff9e2c', secondary: '#e8f1ff', accent: '#ff3b3b', bgDeep: '#050a12', bgBase: '#0a1220', bgSurface: '#101c30', bgElevated: '#182842', textPrimary: '#f2f6ff', textSecondary: '#9fb4d8', fontDisplay: 'exo2', fontMono: 'ibmplexmono', fontTitle: 'orbitron' },
    security: { requiresAuth: true, allowPassword: true, allowKeyItem: true, keyItemName: 'TT Platinum Card', authLogic: 'any', failureMode: 'lockout', maxAttempts: 3, lockoutDuration: 1800000 },
    boot: { enabled: true, title: 'TRAUMA TEAM', subtitle: 'Platinum Response // Dispatch Console', banner: 'TT DISPATCH · AV-4 READY', animationStyle: 'scan-sweep', speed: 'fast', logLines: ['Dispatch uplink ............. LIVE', 'AV-4 telemetry .............. NOMINAL', 'Subscriber database ......... MOUNTED', 'Biomonitor relay ............ ARMED'] },
    accounts: [
      { username: 'dispatch', displayName: 'Dispatch Desk', role: 'DISPATCH OPERATOR', security: { requiresAuth: true, allowPassword: true } },
      { username: 'medlead', displayName: 'Response Lead', isAdmin: true, role: 'PLATINUM TEAM LEAD', security: { requiresAuth: true, allowPassword: true } },
    ],
  },
  'militech-checkpoint': {
    label: 'Militech Checkpoint', icon: 'fas fa-shield-halved', loginStyle: 'keypad', soundSet: 'mil-hardline',
    login: {motd: 'LETHAL FORCE AUTHORIZED BEYOND THIS POINT',welcomeText: 'Checkpoint online. Stay frosty.'},
    screensaver: {enabled: true,idleSeconds: 90,text: 'MILITECH',iconMode: 'boot',faIcon: '',imageUrl: '',motion: 'static'},
    folderNames: {inbox: 'Orders',saved: 'Standing',trash: 'Expired'},
    theme: { primary: '#ffb000', secondary: '#b8c29a', accent: '#ff4d2e', bgDeep: '#0a0c05', bgBase: '#12150a', bgSurface: '#1a1f10', bgElevated: '#252c18', textPrimary: '#eef0e2', textSecondary: '#a8b090', fontDisplay: 'barlowcondensed', fontMono: 'sharetechmono', fontTitle: 'orbitron' },
    security: { requiresAuth: true, allowPassword: true, authLogic: 'any', failureMode: 'damage', encryptionType: 'BLACK_ICE', maxAttempts: 3, lockoutDuration: 3600000 },
    boot: { enabled: true, title: 'MILITECH', subtitle: 'Checkpoint Access Control // ZONE 4', banner: 'M-SEC GATE 07 · ARMED', animationStyle: 'holographic-snap', speed: 'fast', logLines: ['Perimeter mesh .............. ARMED', 'Turret handshake ............ OK', 'Access roster ............... SYNCED'] },
    accounts: [{ username: 'gate07', displayName: 'Gate Console', role: 'CHECKPOINT CONSOLE', security: { requiresAuth: true, allowPassword: true, password: '0451' } }],
  },
  'ncpd-precinct': {
    label: 'NCPD Precinct', icon: 'fas fa-handcuffs', loginStyle: 'roster', soundSet: 'mil-hardline',
    login: {motd: 'ALL ACCESS LOGGED — IAD AUDITS WEEKLY',welcomeText: 'Shift logged. Watch your six out there.'},
    screensaver: {enabled: true,idleSeconds: 150,text: 'NCPD',iconMode: 'boot',faIcon: '',imageUrl: '',motion: 'drift'},
    folderNames: {inbox: 'Case Files',saved: 'Evidence',trash: 'Purged'},
    theme: { primary: '#4aa3ff', secondary: '#ffd257', accent: '#ff5f5f', bgDeep: '#05070d', bgBase: '#0a0f1a', bgSurface: '#111a2b', bgElevated: '#1a2740', textPrimary: '#e9eefb', textSecondary: '#94a5c6', fontDisplay: 'rajdhani', fontMono: 'ibmplexmono', fontTitle: 'orbitron' },
    security: { requiresAuth: true, allowPassword: true, allowSkillCheck: true, bypassSkills: ['Interface'], bypassDC: 17, authLogic: 'any', failureMode: 'lockout', maxAttempts: 4, lockoutDuration: 1800000 },
    boot: { enabled: true, title: 'NCPD', subtitle: 'Evidence & Records // Precinct Net', banner: 'PRECINCT TERMINAL · ALL ACCESS LOGGED', animationStyle: 'standard-fade', speed: 'normal', logLines: ['Precinct net ................ SECURE', 'Evidence locker index ....... MOUNTED', 'Warrant sync ................ CURRENT', 'Bodycam archive ............. ONLINE'] },
    accounts: [
      { username: 'desk_sgt', displayName: 'Desk Sergeant', role: 'DUTY SERGEANT', security: { requiresAuth: true, allowPassword: true } },
      { username: 'evidence', displayName: 'Evidence Custodian', role: 'CUSTODIAN', security: { requiresAuth: true, allowPassword: true } },
    ],
  },
  'nomad-rig': {
    label: 'Nomad Rig-OS', icon: 'fas fa-mountain', loginStyle: 'portraits', soundSet: 'street-bbs',
    login: {motd: 'family only. you know the rules.',welcomeText: 'Welcome home. Road is long.'},
    screensaver: {enabled: true,idleSeconds: 240,text: 'ON THE ROAD',iconMode: 'boot',faIcon: '',imageUrl: '',motion: 'bounce'},
    folderNames: {inbox: 'Radio',saved: 'Maps',trash: 'Dust'},
    theme: { primary: '#ff7a3d', secondary: '#7fd4c1', accent: '#ffd257', bgDeep: '#0d0805', bgBase: '#160e08', bgSurface: '#221610', bgElevated: '#2f1f16', textPrimary: '#f4ece2', textSecondary: '#c2a888', fontDisplay: 'rajdhani', fontMono: 'sharetechmono', fontTitle: 'audiowide' },
    security: { requiresAuth: false },
    boot: { enabled: true, title: 'RIG-OS', subtitle: 'Clan Convoy Mesh // Badlands', banner: 'FAMILY RIG · SHARED', animationStyle: 'warm-dissolve', speed: 'normal', logLines: ['Convoy mesh ................. LINKED', 'Solar array ................. 82%', 'Water recycler .............. OK', 'Radio uplink ................ SCANNING'] },
    accounts: [
      { username: 'driver', displayName: 'Rig Driver', role: 'CONVOY DRIVER', security: { requiresAuth: false } },
      { username: 'quartermaster', displayName: 'Quartermaster', role: 'SUPPLIES', security: { requiresAuth: true, allowPassword: true } },
    ],
  },
  'bd-lounge': {
    label: 'Braindance Lounge', icon: 'fas fa-martini-glass', loginStyle: 'lockscreen', soundSet: 'ghost-wall',
    login: {motd: 'what happens in the booth stays in the booth',welcomeText: 'Enjoy the ride. Tip your editor.'},
    screensaver: {enabled: true,idleSeconds: 120,text: 'VELVET ROOM',iconMode: 'boot',faIcon: '',imageUrl: '',motion: 'drift'},
    folderNames: {inbox: 'Bookings',saved: 'Regulars',trash: 'Burned'},
    theme: { primary: '#ff5fa2', secondary: '#8de3ff', accent: '#c77bff', bgDeep: '#0d040c', bgBase: '#170a16', bgSurface: '#241224', bgElevated: '#321a32', textPrimary: '#fbeaf6', textSecondary: '#c79ab8', fontDisplay: 'rajdhani', fontMono: 'sharetechmono', fontTitle: 'audiowide' },
    security: { requiresAuth: true, allowPassword: true, authLogic: 'any', failureMode: 'lockout', maxAttempts: 3, lockoutDuration: 900000 },
    boot: { enabled: true, title: 'VELVET ROOM', subtitle: 'BD Lounge // Private Booth Console', banner: 'BOOTH 6 · SESSIONS BY APPOINTMENT', animationStyle: 'warm-dissolve', speed: 'dramatic', logLines: ['Booth network ............... UP', 'BD wreath diagnostics ....... PASSED', 'Session ledger .............. LOCKED'] },
    accounts: [{ username: 'boothhost', displayName: 'Booth Host', role: 'LOUNGE HOST', security: { requiresAuth: true, allowPassword: true } }],
  },
  'maelstrom-chopshop': {
    label: 'Maelstrom Chopshop', icon: 'fas fa-skull-crossbones', loginStyle: 'crt', soundSet: 'street-bbs',
    login: {motd: 'FLESH IS A COSTUME',welcomeText: 'meat verified. get to work.'},
    screensaver: {enabled: true,idleSeconds: 100,text: 'MAELSTROM',iconMode: 'boot',faIcon: '',imageUrl: '',motion: 'bounce'},
    folderNames: {inbox: 'Jobs',saved: 'Parts',trash: 'Scrap'},
    theme: { primary: '#ff2222', secondary: '#8d99ae', accent: '#ff7a2f', bgDeep: '#070404', bgBase: '#0e0707', bgSurface: '#180d0d', bgElevated: '#241313', textPrimary: '#f1e6e6', textSecondary: '#a88c8c', fontDisplay: 'sharetechmono', fontMono: 'vt323', fontTitle: 'orbitron' },
    security: { requiresAuth: true, allowPassword: true, allowSkillCheck: true, bypassSkills: ['Interface'], bypassDC: 15, authLogic: 'any', failureMode: 'damage', encryptionType: 'BLACK_ICE', maxAttempts: 3, lockoutDuration: 3600000 },
    boot: { enabled: true, title: 'MEAT-GRID', subtitle: 'chopshop node // no questions', banner: 'DUM DUM SAYS HI', animationStyle: 'glitch-flood', speed: 'fast', logLines: ['rippers online .............. yeah', 'parts inventory ............. dont ask', 'ice ......................... HUNGRY'] },
    accounts: [{ username: 'wrench', displayName: 'Wrench', role: 'CHOP LEAD', security: { requiresAuth: true, allowPassword: true } }],
  },
  'blackwall-relay': {
    label: 'Blackwall Relay', icon: 'fas fa-infinity', loginStyle: 'crt', soundSet: 'ghost-wall',
    login: {motd: 'DO NOT ANSWER. DO NOT ANSWER. DO NOT ANSWER.',welcomeText: 'it sees you now.'},
    screensaver: {enabled: true,idleSeconds: 60,text: '██████',iconMode: 'boot',faIcon: '',imageUrl: '',motion: 'static'},
    folderNames: {inbox: 'Signals',saved: 'Kept',trash: 'Devoured'},
    theme: { primary: '#ff1a1a', secondary: '#6b6b7a', accent: '#ff5252', bgDeep: '#030303', bgBase: '#080607', bgSurface: '#100a0c', bgElevated: '#180f12', textPrimary: '#e8dede', textSecondary: '#8d7a7e', fontDisplay: 'sharetechmono', fontMono: 'sharetechmono', fontTitle: 'orbitron' },
    security: { requiresAuth: true, allowSkillCheck: true, bypassSkills: ['Interface'], bypassDC: 22, authLogic: 'any', failureMode: 'damage', encryptionType: 'BLACK_ICE', maxAttempts: 2, lockoutDuration: 7200000 },
    boot: { enabled: true, title: 'RELAY-0', subtitle: '?????? // DO NOT ANSWER', banner: 'SIGNAL ORIGIN: BEYOND', animationStyle: 'crt-power-on', speed: 'dramatic', logLines: ['handshake ................... [no carrier]', 'handshake ................... [no carrier]', 'handshake ................... ACCEPTED', 'something is listening ......'] },
    accounts: [{ username: 'null', displayName: '▓▓▓▓▓', role: 'UNKNOWN', hidden: false, security: { requiresAuth: true, allowSkillCheck: true, bypassSkills: ['Interface'], bypassDC: 22 } }],
  },
});

/**
 * Terminal sound sets (config.soundSet) — per-terminal sound palettes built
 * by remapping the terminal's sound ids onto existing SOUND_PATHS assets with
 * playback-rate + volume shaping (the playClick Web Audio precedent), so a
 * corp box chimes politely while a chopshop CRT growls — no new audio files.
 *
 * `map` is keyed by the ORIGINAL sound id the code plays; each entry may
 * remap the id and/or shape it: { id?, rate?, volume? }. Ids absent from the
 * map play unchanged, so 'default' is the empty map. Resolution goes through
 * resolveTerminalSound (helpers.js) → SoundService.playStyled. Icons must be
 * valid FA6-free classes (the arasaka fa-building-shield lesson).
 */
export const TERMINAL_SOUND_SETS = Object.freeze({
  'default': {
    label: 'Standard', icon: 'fas fa-volume-high',
    hint: 'The stock NCM terminal sounds, unshaped.',
    map: {},
  },
  'corp-chime': {
    label: 'Corp Chime', icon: 'fas fa-bell-concierge',
    hint: 'Polite office chimes — soft, clean, slightly high-pitched.',
    map: {
      'shard-boot':    { id: 'connect', rate: 1.12, volume: 0.75 },
      'login-success': { id: 'key-accepted', rate: 1.15, volume: 0.85 },
      'login-fail':    { id: 'key-rejected', rate: 1.1, volume: 0.75 },
      'hack-success':  { id: 'key-accepted', rate: 1.0, volume: 0.85 },
      'hack-fail':     { id: 'key-rejected', rate: 0.95, volume: 0.8 },
      'send':          { rate: 1.12, volume: 0.85 },
      'receive':       { rate: 1.12, volume: 0.85 },
      'shard-compile': { rate: 1.1, volume: 0.8 },
      'shard-insert':  { rate: 1.15, volume: 0.85 },
      'shard-decrypt': { rate: 1.15, volume: 0.8 },
    },
  },
  'street-bbs': {
    label: 'Street BBS', icon: 'fas fa-tower-cell',
    hint: 'Grungy back-alley board — slow, chuggy, modem-adjacent.',
    map: {
      'shard-boot':    { id: 'shard-compile', rate: 0.8 },
      'login-success': { id: 'connect', rate: 0.82 },
      'login-fail':    { id: 'dead-zone', rate: 1.05, volume: 0.9 },
      'hack-success':  { rate: 0.85 },
      'hack-fail':     { rate: 0.85 },
      'send':          { rate: 0.85 },
      'receive':       { rate: 0.8 },
      'shard-compile': { rate: 0.85 },
      'shard-insert':  { rate: 0.85 },
      'shard-decrypt': { rate: 0.85 },
    },
  },
  'med-soft': {
    label: 'MedTech Soft', icon: 'fas fa-heart-pulse',
    hint: 'Quiet clinical monitor tones — high, gentle, unobtrusive.',
    map: {
      'shard-boot':    { id: 'open', rate: 1.25, volume: 0.6 },
      'login-success': { id: 'key-accepted', rate: 1.35, volume: 0.55 },
      'login-fail':    { id: 'key-rejected', rate: 1.3, volume: 0.6 },
      'hack-success':  { id: 'key-accepted', rate: 1.2, volume: 0.55 },
      'hack-fail':     { id: 'key-rejected', rate: 1.15, volume: 0.65 },
      'send':          { rate: 1.25, volume: 0.6 },
      'receive':       { rate: 1.25, volume: 0.6 },
      'shard-compile': { rate: 1.2, volume: 0.6 },
      'shard-insert':  { rate: 1.3, volume: 0.6 },
      'shard-decrypt': { rate: 1.25, volume: 0.6 },
    },
  },
  'mil-hardline': {
    label: 'Military Hardline', icon: 'fas fa-shield-halved',
    hint: 'Hard checkpoint tones — deep, loud, hostile on failure.',
    map: {
      'shard-boot':    { rate: 0.85 },
      'login-success': { id: 'hack-success', rate: 0.9 },
      'login-fail':    { id: 'lockout', rate: 1.15, volume: 0.9 },
      'hack-fail':     { id: 'lockout', rate: 1.1, volume: 0.9 },
      'send':          { rate: 0.9 },
      'receive':       { rate: 0.9 },
      'shard-compile': { rate: 0.9 },
      'shard-insert':  { rate: 0.9 },
      'shard-decrypt': { rate: 0.95 },
    },
  },
  'ghost-wall': {
    label: 'Ghost Signal', icon: 'fas fa-ghost',
    hint: 'Slowed, hollow, half-heard — haunted iron and Blackwall relays.',
    map: {
      'shard-boot':    { rate: 0.62, volume: 0.7 },
      'login-success': { id: 'shard-decrypt', rate: 0.7, volume: 0.7 },
      'login-fail':    { id: 'hack-fail', rate: 0.6, volume: 0.7 },
      'hack-success':  { rate: 0.65, volume: 0.7 },
      'hack-fail':     { rate: 0.6, volume: 0.7 },
      'send':          { rate: 0.65, volume: 0.7 },
      'receive':       { rate: 0.6, volume: 0.7 },
      'shard-compile': { rate: 0.65, volume: 0.7 },
      'shard-insert':  { rate: 0.6, volume: 0.7 },
      'shard-decrypt': { rate: 0.65, volume: 0.7 },
    },
  },
});

/**
 * Boot splash entrance animations (config.boot.animationStyle) — each is a
 * distinct CSS treatment keyed by `data-boot-animation` on `.ncm-term__boot`
 * (and mirrored in the config's live preview). Unknown/legacy values render
 * the standard fade.
 */
export const BOOT_ANIMATIONS = Object.freeze([
  { key: 'standard-fade', label: 'standard fade', hint: 'Quiet corporate fade-in.' },
  { key: 'holographic-snap', label: 'holographic snap', hint: 'Icon snaps in oversized, settles with a glow pulse.' },
  { key: 'scan-sweep', label: 'scan sweep', hint: 'A light bar sweeps down, revealing the splash.' },
  { key: 'warm-dissolve', label: 'warm dissolve', hint: 'Soft blur dissolves into focus.' },
  { key: 'glitch-flood', label: 'glitch flood', hint: 'RGB-split jitter bursts while the title fights into place.' },
  { key: 'crt-power-on', label: 'CRT power-on', hint: 'Old tube turn-on: a bright line stretches open.' },
]);

/**
 * Login-screen styles (config.loginStyle). Same accounts/security/auth flow
 * underneath — only the presentation changes; every style follows the
 * terminal theme palette. 'cards' is the original default.
 */
/**
 * Curated FA6-FREE icons for the mailbox folder editor (Identity tab). Small
 * on purpose — folder chips are tiny; every class verified free-solid/regular
 * (an invalid class renders an EMPTY square — the arasaka lesson).
 */
export const TERMINAL_FOLDER_ICONS = Object.freeze([
  { c: 'fas fa-inbox', label: 'Inbox' },
  { c: 'fas fa-folder', label: 'Folder' },
  { c: 'fas fa-folder-open', label: 'Folder (open)' },
  { c: 'fa-regular fa-star', label: 'Star' },
  { c: 'fas fa-trash-can', label: 'Trash' },
  { c: 'fas fa-briefcase', label: 'Case files' },
  { c: 'fas fa-magnifying-glass', label: 'Evidence' },
  { c: 'fas fa-box-archive', label: 'Archive' },
  { c: 'fas fa-database', label: 'Records' },
  { c: 'fas fa-envelope', label: 'Mail' },
  { c: 'fas fa-flag', label: 'Flagged' },
  { c: 'fas fa-shield-halved', label: 'Security' },
  { c: 'fas fa-skull', label: 'Black ops' },
  { c: 'fas fa-heart-pulse', label: 'Medical' },
  { c: 'fas fa-file-lines', label: 'Documents' },
  { c: 'fas fa-lock', label: 'Classified' },
  { c: 'fas fa-bug', label: 'Malware' },
  { c: 'fas fa-photo-film', label: 'Media' },
  { c: 'fas fa-sack-dollar', label: 'Finance' },
  { c: 'fas fa-users', label: 'Personnel' },
]);

export const TERMINAL_LOGIN_STYLES = Object.freeze([
  { key: 'cards', label: 'Badge Cards', icon: 'fas fa-id-card', hint: 'Corporate ID-card grid — the classic workstation look.' },
  { key: 'crt', label: 'CRT Prompt', icon: 'fas fa-terminal', hint: 'Full-screen phosphor tty with a typed login: prompt. BBS / retro-DOS.' },
  { key: 'roster', label: 'Duty Roster', icon: 'fas fa-list-check', hint: 'Sign-in rows with roles and shift status. Precincts, clinics, NetWatch.' },
  { key: 'lockscreen', label: 'Lock Screen', icon: 'fas fa-user-lock', hint: 'One big portrait + passcode. Personal rigs and lifted laptops.' },
  { key: 'keypad', label: 'Keypad Panel', icon: 'fas fa-calculator', hint: 'Hardware keypad + LCD. Door terminals, vaults, maglocks. Numeric codes shine.' },
  { key: 'portraits', label: 'Portrait Row', icon: 'fas fa-users', hint: 'Big avatars side by side. Shared household / crew machines.' },
]);

/**
 * Curated Font Awesome 6 FREE solid icons for the visual boot-icon picker
 * (config Boot & Login tab). `k` = search keywords. All classes verified
 * against FA6-free (the arasaka fa-building-shield lesson: an invalid glyph
 * renders as an EMPTY square, so only ship known-good ones here).
 */
export const TERMINAL_ICON_LIBRARY = Object.freeze([
  { c: 'fas fa-building', k: 'corp office tower company arasaka' },
  { c: 'fas fa-city', k: 'corp skyline downtown night city' },
  { c: 'fas fa-landmark', k: 'bank gov government institution' },
  { c: 'fas fa-terminal', k: 'console dos prompt shell' },
  { c: 'fas fa-server', k: 'server rack host node' },
  { c: 'fas fa-database', k: 'data db storage records' },
  { c: 'fas fa-microchip', k: 'chip cpu hardware tech' },
  { c: 'fas fa-network-wired', k: 'net lan network wired' },
  { c: 'fas fa-wifi', k: 'wireless signal net' },
  { c: 'fas fa-tower-broadcast', k: 'antenna broadcast radio signal' },
  { c: 'fas fa-satellite-dish', k: 'netwatch dish uplink satellite' },
  { c: 'fas fa-satellite', k: 'orbit satellite space' },
  { c: 'fas fa-robot', k: 'ai bot android drone' },
  { c: 'fas fa-brain', k: 'ai mind neural psycho' },
  { c: 'fas fa-eye', k: 'surveillance watch spy camera' },
  { c: 'fas fa-video', k: 'camera cctv surveillance bd' },
  { c: 'fas fa-skull', k: 'gang death hacker streetkid' },
  { c: 'fas fa-skull-crossbones', k: 'danger poison pirate death' },
  { c: 'fas fa-ghost', k: 'netrunner phantom spooky anon' },
  { c: 'fas fa-mask', k: 'darknet anonymous thief' },
  { c: 'fas fa-user-secret', k: 'spy agent fixer incognito' },
  { c: 'fas fa-shield-halved', k: 'security guard defense militech' },
  { c: 'fas fa-lock', k: 'secure vault locked' },
  { c: 'fas fa-key', k: 'access key credential' },
  { c: 'fas fa-fingerprint', k: 'biometric id identity' },
  { c: 'fas fa-id-card', k: 'badge credential card' },
  { c: 'fas fa-gun', k: 'weapon arms dealer militech' },
  { c: 'fas fa-crosshairs', k: 'target sniper merc solo' },
  { c: 'fas fa-bomb', k: 'demolition explosive' },
  { c: 'fas fa-radiation', k: 'nuclear hazard hot zone' },
  { c: 'fas fa-biohazard', k: 'toxic hazard plague lab' },
  { c: 'fas fa-flask', k: 'lab chemistry science biotechnica' },
  { c: 'fas fa-dna', k: 'biotech genetics lab' },
  { c: 'fas fa-syringe', k: 'ripperdoc medical drug clinic' },
  { c: 'fas fa-staff-snake', k: 'medical ripperdoc clinic asclepius' },
  { c: 'fas fa-heart-pulse', k: 'medical trauma team health' },
  { c: 'fas fa-pills', k: 'pharma drugs meds' },
  { c: 'fas fa-truck-medical', k: 'trauma team ambulance' },
  { c: 'fas fa-hospital', k: 'clinic hospital medcenter' },
  { c: 'fas fa-car', k: 'vehicle garage transport' },
  { c: 'fas fa-motorcycle', k: 'bike nomad vehicle' },
  { c: 'fas fa-truck', k: 'convoy logistics shipping' },
  { c: 'fas fa-plane', k: 'av aircraft airport transport' },
  { c: 'fas fa-ship', k: 'harbor dock cargo smuggle' },
  { c: 'fas fa-anchor', k: 'dock harbor port' },
  { c: 'fas fa-gas-pump', k: 'fuel station nomad' },
  { c: 'fas fa-bolt', k: 'power electric grid energy' },
  { c: 'fas fa-plug', k: 'power socket electric' },
  { c: 'fas fa-industry', k: 'factory plant industrial' },
  { c: 'fas fa-gears', k: 'machine workshop tech mechanic' },
  { c: 'fas fa-wrench', k: 'repair mechanic garage' },
  { c: 'fas fa-hammer', k: 'construction tools workshop' },
  { c: 'fas fa-hard-hat', k: 'construction site worker' },
  { c: 'fas fa-music', k: 'club chrome rock lizzy' },
  { c: 'fas fa-guitar', k: 'rockerboy samurai band' },
  { c: 'fas fa-martini-glass', k: 'bar club afterlife drink' },
  { c: 'fas fa-champagne-glasses', k: 'club vip party' },
  { c: 'fas fa-dice', k: 'casino gambling luck' },
  { c: 'fas fa-coins', k: 'eddies money bank finance' },
  { c: 'fas fa-money-bill-wave', k: 'cash eddies payment' },
  { c: 'fas fa-vault', k: 'bank safe vault storage' },
  { c: 'fas fa-scale-balanced', k: 'law court justice legal' },
  { c: 'fas fa-gavel', k: 'court judge law' },
  { c: 'fas fa-handcuffs', k: 'ncpd police arrest' },
  { c: 'fas fa-building-shield', k: 'precinct police station ncpd', invalid: true },
  { c: 'fas fa-shield', k: 'precinct police badge ncpd' },
  { c: 'fas fa-newspaper', k: 'media press news reporter' },
  { c: 'fas fa-camera', k: 'media photo journalist' },
  { c: 'fas fa-microphone', k: 'media broadcast radio podcast' },
  { c: 'fas fa-tv', k: 'media screen broadcast n54' },
  { c: 'fas fa-globe', k: 'net worldwide global public' },
  { c: 'fas fa-envelope', k: 'mail message post' },
  { c: 'fas fa-phone', k: 'call agent comms' },
  { c: 'fas fa-comments', k: 'chat comms talk' },
  { c: 'fas fa-book', k: 'library archive records lore' },
  { c: 'fas fa-box-archive', k: 'archive records storage' },
  { c: 'fas fa-folder-open', k: 'files documents records' },
  { c: 'fas fa-file-contract', k: 'contract gig fixer deal' },
  { c: 'fas fa-clipboard-list', k: 'manifest inventory list' },
  { c: 'fas fa-warehouse', k: 'storage depot logistics' },
  { c: 'fas fa-boxes-stacked', k: 'cargo inventory shipment' },
  { c: 'fas fa-utensils', k: 'restaurant food vendor' },
  { c: 'fas fa-burger', k: 'food stand vendor street' },
  { c: 'fas fa-shirt', k: 'fashion clothes shop' },
  { c: 'fas fa-cart-shopping', k: 'shop market store vendor' },
  { c: 'fas fa-store', k: 'shop market kiosk' },
  { c: 'fas fa-hotel', k: 'motel hotel rooms' },
  { c: 'fas fa-bed', k: 'motel sleep capsule' },
  { c: 'fas fa-dumbbell', k: 'gym training fitness' },
  { c: 'fas fa-paw', k: 'animals gang paws pets' },
  { c: 'fas fa-dragon', k: 'tyger claws gang dragon' },
  { c: 'fas fa-spider', k: 'net crawler gang web' },
  { c: 'fas fa-crow', k: 'bird raven watcher' },
  { c: 'fas fa-cat', k: 'cat pet stray' },
  { c: 'fas fa-fire', k: 'burn heat valentinos flame' },
  { c: 'fas fa-snowflake', k: 'cold ice freezer cryo' },
  { c: 'fas fa-moon', k: 'night lunar dark' },
  { c: 'fas fa-sun', k: 'day solar light' },
  { c: 'fas fa-cloud', k: 'weather data cloud' },
  { c: 'fas fa-mountain', k: 'badlands outside nomad' },
  { c: 'fas fa-tree', k: 'park nature green' },
  { c: 'fas fa-chess-knight', k: 'strategy game chess' },
  { c: 'fas fa-puzzle-piece', k: 'game puzzle piece' },
  { c: 'fas fa-gamepad', k: 'arcade game console' },
  { c: 'fas fa-vr-cardboard', k: 'braindance bd vr' },
  { c: 'fas fa-hand-fist', k: 'gang power fight resist' },
  { c: 'fas fa-star', k: 'vip favorite rating' },
  { c: 'fas fa-triangle-exclamation', k: 'warning danger alert' },
  { c: 'fas fa-circle-radiation', k: 'reactor core power hot' },
  { c: 'fas fa-atom', k: 'science reactor physics' },
  { c: 'fas fa-infinity', k: 'blackwall ai beyond' },
].filter(i => !i.invalid));

/**
 * Flavor pools for the Boot & Login tab's "generate flavor lines" dice — the
 * generator picks a template + status at random per line.
 */
export const BOOT_FLAVOR_LINES = Object.freeze({
  templates: Object.freeze([
    'Handshake with {NET} ......', 'Credential gateway ........', 'ICE lattice ...............',
    'Mounting user volumes .....', 'Neural link sync ..........', 'Daemon watchdog ...........',
    'Firmware checksum .........', 'Intrusion countermeasure ..', 'Peripheral bus scan .......',
    'Memory integrity ..........', 'Uplink negotiation ........', 'Session key exchange ......',
    'Biometric module ..........', 'Cold storage index ........', 'Subnet heartbeat ..........',
  ]),
  statuses: Object.freeze(['OK', 'ONLINE', 'VERIFIED', 'ARMED', 'STANDBY', 'READY', 'SECURE', 'NOMINAL']),
  nets: Object.freeze(['CITINET', 'CORPNET', 'DARKNET', 'LOCAL-0']),
});

// ─── Sound Paths ───

export const SOUND_PATHS = Object.freeze({
  'open': 'ui/open.ogg', 'close': 'ui/close.ogg', 'click': 'ui/click.ogg',
  'keystroke': 'ui/keystroke.ogg', 'error': 'ui/error.ogg',
  'receive': 'messages/receive.ogg', 'receive-urgent': 'messages/receive-urgent.ogg',
  'send': 'messages/send.ogg', 'queue-flush': 'messages/queue-flush.ogg',
  'destruct': 'messages/destruct.ogg',
  'connect': 'network/connect.ogg', 'disconnect': 'network/disconnect.ogg',
  'switch': 'network/switch.ogg', 'dead-zone': 'network/dead-zone.ogg',
  'hack-start': 'security/hack-start.ogg', 'hack-progress': 'security/hack-progress.ogg',
  'hack-success': 'security/hack-success.ogg', 'hack-fail': 'security/hack-fail.ogg',
  'black-ice': 'security/black-ice.ogg', 'lockout': 'security/lockout.ogg',
  'login-success': 'security/login-success.ogg', 'login-fail': 'security/login-fail.ogg',
  'key-accepted': 'security/key-accepted.ogg', 'key-rejected': 'security/key-rejected.ogg',
  'shard-insert': 'shard/insert.ogg', 'shard-decrypt': 'security/shard-decrypt.ogg',
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
  IDENTITY_DRAWER: `${T}/message-viewer/partials/identity-drawer.hbs`,
  MESSAGE_COMPOSER: `${T}/message-composer/message-composer.hbs`,
  CONTACT_MANAGER: `${T}/contact-manager/contact-manager.hbs`,
  GM_CONTACT_MANAGER: `${T}/gm-contact-manager/gm-contact-manager.hbs`,
  ACTOR_IMPORT_PICKER: `${T}/gm-contact-manager/actor-import-picker.hbs`,
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
  ADMIN_TAB_OVERVIEW: `${T}/admin-panel/tab-overview.hbs`,
  ADMIN_TAB_MESSAGES: `${T}/admin-panel/tab-messages.hbs`,
  ADMIN_TAB_CONTACTS: `${T}/admin-panel/tab-contacts.hbs`,
  ADMIN_TAB_NETWORKS: `${T}/admin-panel/tab-networks.hbs`,
  ADMIN_TAB_SHARDS: `${T}/admin-panel/tab-shards.hbs`,
  ADMIN_TAB_TERMINALS: `${T}/admin-panel/tab-terminals.hbs`,
  ADMIN_TAB_SECURITY: `${T}/admin-panel/tab-security.hbs`,
  ADMIN_TAB_SPAM: `${T}/admin-panel/tab-spam.hbs`,
  ADMIN_TAB_TOOLS: `${T}/admin-panel/tab-tools.hbs`,
  ADMIN_NETWORK_CARD: `${T}/admin-panel/partials/network-card.hbs`,
  THEME_CUSTOMIZER: `${T}/theme-customizer/theme-customizer.hbs`,
  NETWORK_AUTH_DIALOG: `${T}/dialogs/network-auth-dialog.hbs`,
  CREATE_NETWORK_DIALOG: `${T}/dialogs/create-network.hbs`,
  DEAD_ZONE_WARNING: `${T}/dialogs/dead-zone-warning.hbs`,
  NETWORK_SELECTOR: `${T}/message-viewer/partials/network-selector.hbs`,
  PLAYER_EMAIL_SETUP: `${T}/dialogs/player-email-setup.hbs`,
  EMAIL_SETUP_FLOW: `${T}/dialogs/email-setup.hbs`,
  CHAT_MESSAGE_CARD: `${T}/chat/message-card.hbs`,
  CHAT_HACK_RESULT: `${T}/chat/hack-result.hbs`,
  CHAT_ICE_RETALIATION: `${T}/chat/ice-retaliation.hbs`,
  CHAT_NETWORK_BROADCAST: `${T}/chat/network-broadcast.hbs`,
  CHAT_MALWARE_ANALYSIS: `${T}/chat/malware-analysis.hbs`,
  CONTACT_CARD:           `${T}/contact-manager/partials/contact-card.hbs`,
  CONTACT_LIST_ITEM:      `${T}/contact-manager/partials/contact-list-item.hbs`,
  CONTACT_TRUST_METER:    `${T}/contact-manager/partials/trust-meter.hbs`,
  CONTACT_TRUST_DETAIL: `${T}/contact-manager/partials/trust-detail.hbs`,
  CONTACT_ENCRYPTED:      `${T}/contact-manager/partials/encrypted-overlay.hbs`,
  CONTACT_ENCRYPTED_CARD: `${T}/contact-manager/partials/encrypted-card-overlay.hbs`,
  CONTACT_FORM:          `${T}/contact-manager/partials/contact-form.hbs`,
  CONTACT_GROUPS_PANEL:  `${T}/contact-manager/partials/contact-groups-panel.hbs`,
  CONTACT_DETAIL:        `${T}/contact-manager/partials/contact-detail.hbs`,
  CONTACT_QUICKDIAL:     `${T}/contact-manager/partials/contact-quickdial.hbs`,
  CONTACT_GROUP_HEADER:  `${T}/contact-manager/partials/contact-group-header.hbs`,
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
  // Shared content-type body renderer (shards + terminals) — design doc §8c.
  CONTENT_BODY: `${T}/content/content-body.hbs`,
  PARTIAL_ENCRYPTED_ATTACHMENT: `${T}/partials/encrypted-attachment.hbs`,
  PARTIAL_ATTACHMENT_CHIP:      `${T}/partials/attachment-chip.hbs`,
  // ─── Terminal Expansion ───
  TERMINAL_VIEWER: `${T}/terminal/terminal-viewer.hbs`,
  TERMINAL_BOOT: `${T}/terminal/terminal-boot.hbs`,
  TERMINAL_LOGIN: `${T}/terminal/terminal-login.hbs`,
  TERMINAL_MANUAL_LOGIN: `${T}/terminal/terminal-manual-login.hbs`,
  TERMINAL_NETWORK_GATE: `${T}/terminal/terminal-network-gate.hbs`,
  TERMINAL_ACCOUNT_CARD: `${T}/terminal/partials/account-card.hbs`,
  TERMINAL_UPLINK: `${T}/terminal/partials/uplink.hbs`,
  TERMINAL_OPERATOR_CHIP: `${T}/terminal/partials/operator-chip.hbs`,
  TERMINAL_CONFIG: `${T}/terminal/terminal-config.hbs`,
  TERMINAL_CONFIG_ACCOUNT: `${T}/terminal/partials/config-account.hbs`,
  MALWARE_WORKSHOP: `${T}/malware-workshop/malware-workshop.hbs`,
  SHARD_ENCODER: `${T}/shard-encoder/shard-encoder.hbs`,
  ENCODER_CONFIG: `${T}/shard-encoder/encoder-config.hbs`,
  PROGRAM_DECK: `${T}/program-deck/program-deck.hbs`,
});

// ─── Default Configs ───

export const DEFAULTS = Object.freeze({
  PLAYER_THEME: {
    preset: 'classic',
    colors: { primary: null, secondary: null, accent: null, bgDeep: null, bgBase: null, bgSurface: null, bgElevated: null, textPrimary: null, textSecondary: null },
    fonts: { display: 'rajdhani', mono: 'sharetechmono', title: 'orbitron' },
    textScale: 100, contrast: 100, agentName: 'Agent',
    scanlines: true, glitchIntensity: 0.5, animationLevel: 'full', neonGlow: true,
    // wallpaper = image behind the MessageViewer panes (Theme Customizer →
    // Effects); strength 0–100 drives --ncm-wallpaper-strength (default 25).
    messageDensity: 'normal', sidebarWidth: 300, defaultSort: 'newest', showAvatars: true, wallpaper: null, wallpaperStrength: 25,
    soundEnabled: true, soundVolume: 0.5, ambientEnabled: false,
  },
  // GM-tool theme — separate from PLAYER_THEME. Clean/utilitarian by default;
  // presets are pure CSS keyed by [data-ncm-admin-theme], stamped on the Admin
  // Panel AND every ADMIN_THEMED GM window + its dialogs (utils/adminTheme.js).
  ADMIN_THEME: {
    preset: 'clean-dark',   // 'clean-dark' | 'clean-light' | 'high-contrast'
    textScale: 100,         // 100-150 (%) - CSS zoom on the panel content + frame grows to match
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
    // The full shape (legibility, effects, loss rules, recovery, the dead screen)
    // lives in IntegrityModel.INTEGRITY_DEFAULTS; resolveIntegrity() layers any
    // stored block over it, so these few keys are all a fresh shard needs.
    integrity: {
      enabled: false,
      mode: 'cosmetic',                // 'cosmetic' (visual only) | 'mechanical' (data loss)
      maxIntegrity: 100,
      currentIntegrity: 100,
      degradePerFailure: 15,
      corruptionThreshold: 50,         // PERCENT — data loss starts below this
      corruptionChance: 0.4,           // per entry, per failed breach
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
    keyItemImg: null,
    keyItemTag: null,
    keyItemDisplayName: '',
    keyItemIcon: 'fa-id-card',
    keyItemBypassLogin: true,
    keyItemBypassEncryption: false,
    keyItemConsumeOnUse: false,
    maxKeyItemAttempts: 3,

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
    textScale: 100,                  // 80–150 (%) — per-shard text size, multiplied by the player's own Text Size
    contrast: 100,                   // 70–140 (%) — per-shard readability contrast (OKLCH tone-map), on top of the player's own
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
  // ─── Terminal Expansion ───────────────────────────────────────
  // A Terminal is a converted Item you "log into" (vs. a Data Shard, a file
  // you crack open). Mirrors the shard three-flag pattern: isTerminal / config
  // (TERMINAL_CONFIG) / state (TERMINAL_STATE) / journalId. Messages live in one
  // linked journal, each page tagged with the owning account's id.

  // One login + mailbox on a Terminal. The `security` block is BYTE-FOR-BYTE the
  // same shape networks and shards use (see NetworkService._buildNetworkObject),
  // so the method-card auth dialog + SecurityService lockout work unchanged — the
  // login just keys on targetId = `${terminalId}::${accountId}`.
  TERMINAL_ACCOUNT: {
    id: '',                       // stable id
    username: '',                 // what you type at login (e.g. "v_arasaka")
    displayName: '',              // shown in the chrome once logged in
    email: '',                    // optional NCM email → identity resolution / "Add to contacts"
    // ── Credential / badge fields (immersion; shown on the ACCESS GRANTED card) ──
    role: '',                     // job title, e.g. "Executive · Floor 7F"
    clearance: '',                // clearance level label, e.g. "TIER 3" (blank → ADMIN/STANDARD from isAdmin)
    idNumber: '',                 // badge ID, e.g. "NC-8841-A" (blank → email/username)
    classification: '',           // per-account classification override (blank → terminal metadata.classification)
    location: '',                 // badge location line (blank → terminal metadata.location)
    lastLogin: '',                // GM flavor "last access" string (blank → FIRST LOGIN)
    // Identity link — an account is a messageable identity. It can link to (or
    // seed) a GM master contact so it carries a real portrait and stays consistent
    // across the campaign. Portrait resolves via PortraitService.resolvePortrait
    // ({ portrait, actorId } → linked master contact → initials fallback).
    masterContactId: '',          // linked MasterContactService contact id (optional)
    actorId: '',                  // linked actor id (optional) — drives portrait + identity
    portrait: '',                 // explicit portrait override (else resolved from contact/actor)
    isAdmin: false,               // admin sees all accounts (privilege tiers → P2)
    hidden: false,                // NOT shown on the login card list — reachable only by typing
                                  // its username via "Log in with another account" (secret login)
    // Network visibility — checked against the TERMINAL's own uplink (see
    // TERMINAL_CONFIG.connection), never the player's Agent network. A gated
    // account VANISHES from the login list (and the secret-login path) until
    // the machine connects to a matching network. Same shape as shard entry
    // networkVisibility so the check is shared.
    network: { restricted: false, allowedNetworks: [], allowedTypes: [] },
    security: {
      requiresAuth: false,        // false = open account, no login gate
      password: '',
      allowPassword: false,
      allowSkillCheck: false,
      authLogic: 'any',           // 'any' = OR (any one method), 'all' = AND (every method)
      bypassSkills: [],
      bypassDC: 15,
      allowKeyItem: false,
      keyItemName: '',
      keyItemTag: '',
      keyItemImg: '',
      keyItemConsume: false,
      maxAttempts: 3,
      lockoutDuration: 3600000,   // 1h lockout after maxAttempts failures
      encryptionType: 'ICE',
      failureMode: 'lockout',     // 'nothing' | 'lockout' | 'permanent' | 'damage' | 'destroy'
      ice: { source: 'default', actorId: null, customName: '', customPortrait: '', customDamage: '' },
    },
    theme: null,                  // optional per-account theme override (→ P2)
  },

  TERMINAL_CONFIG: {
    terminalName: '',             // display override (empty = use item name)
    metadata: { owner: 'Unknown', org: '', location: '', classification: '' },

    // Login banner / boot splash — reuses the shard boot idea (banner carries the
    // "whose machine is this" story alongside the theme).
    boot: {
      enabled: true,
      title: 'TERMINAL',
      subtitle: 'Establishing secure session...',
      banner: '',                 // freeform ASCII / login MOTD shown on the login screen
      logLines: [
        'Link established ............ OK',
        'Authenticating .............. STANDBY',
      ],
      speed: 'normal',            // 'fast' | 'normal' | 'dramatic'
    },

    // Per-terminal theme — applied to the .ncm-terminal-viewer element (NOT :root),
    // so a hacked corp box looks corporate while the player's own client is untouched.
    theme: { preset: 'classic' },

    // Network gate — reuses the shard network-availability shape. required:false =
    // reachable from anywhere (no network hack first). This is Layer 0 — "you must
    // be on network X to reach this box at all" — and gates on the PLAYER's network.
    network: { required: false, accessMode: 'any', allowedNetworks: [], allowedTypes: [], signalThreshold: 40 },

    // Scene access pin — drag the terminal item onto a scene to place a
    // clickable map-note access point (TerminalScenePins). range = grid squares
    // a player's token must be within to log in FROM THE PIN (0 = no limit;
    // GMs bypass; opening from the item itself is deliberately ungated).
    scenePin: { range: 0 },

    // HOW gated hack/upload actions on THIS box resolve (design §5) — 'inherit'
    // follows the world `hackResolution` setting; 'auto' | 'flagged' | 'gm'
    // override it for the odd box (a Blackwall relay the table always runs live).
    hackResolution: 'inherit',

    // Machine uplink — the TERMINAL's own connection (Layer 1), independent of the
    // player's Agent network. Interfaces = what the machine's hardware can reach
    // (scene availability / dead zones deliberately do NOT apply — a wired box works
    // in a jam). preAuthorized = the machine is already joined (corp workstation on
    // CORPNET); otherwise switching runs the network's own security block, and a
    // success is remembered in TERMINAL_STATE.connection.authenticated.
    connection: {
      interfaces: [],             // [ { networkId, preAuthorized: bool } ]
      defaultNetworkId: null,     // boot-time connection (null = LOCAL ONLY)
      allowPlayerSwitching: true, // false = pill renders static (GM/story-driven switches only)
      showSyncHint: true,         // mailbox shows "N objects failed to sync" when content is off-net
    },

    accounts: [],                 // [ TERMINAL_ACCOUNT, ... ] — authored by the GM
    defaultAccountId: '',         // login screen default selection

    // Login-screen look — one of TERMINAL_LOGIN_STYLES. 'cards' = the original
    // badge-card grid (default). All styles share the same accounts/security/
    // auth flow underneath and follow the terminal theme palette.
    loginStyle: 'cards',
    // Login-screen flavor: motd = a banner line under the hero ("UNAUTHORIZED
    // ACCESS WILL BE TRACED"); welcomeText = custom ACCESS GRANTED line
    // (empty = the default "Welcome, {name}").
    login: { motd: '', welcomeText: '' },
    // Idle screensaver — after idleSeconds with no interaction the mailbox dims
    // to a logo + marquee text; any click/keypress wakes it. iconMode:
    // 'boot' (follow the boot icon) | 'fa' | 'image' | 'none'; motion:
    // 'drift' | 'bounce' | 'static'.
    screensaver: { enabled: false, idleSeconds: 120, text: '', iconMode: 'boot', faIcon: '', imageUrl: '', motion: 'drift' },
    // Diegetic folder labels (empty = Inbox / Saved / Trash) — e.g. a cop box
    // reads CASE FILES / EVIDENCE / PURGED. System folder NAMES deliberately
    // stay here (presets/preset-library carry folderNames) — `folders` below
    // only layers icons/visibility/customs on top.
    folderNames: { inbox: '', saved: '', trash: '' },
    // Modular folder set (Identity tab editor → viewer sidebar): per-folder
    // icons, saved/trash visibility toggles, and GM-authored CUSTOM folders
    // ([{ id, name, icon }]). A message joins a custom folder via its `folder`
    // flag (composer Entry Header); messages whose folder no longer exists
    // fall back to the Inbox. Resolved by TerminalService.getFolders.
    folders: { icons: {}, savedEnabled: true, trashEnabled: true, custom: [] },
    // Per-terminal sound palette — a TERMINAL_SOUND_SETS key. Sets remap the
    // terminal's sound ids onto other SOUND_PATHS entries with rate/volume
    // shaping (no new audio assets). All terminal-played sounds resolve
    // through resolveTerminalSound (helpers.js) — never play a raw id.
    soundSet: 'default',

    allowExfil: true,             // master switch: can players copy messages out at all?
    // Per-action exfil policy. Each action: allow (shown), require (needs a
    // security roll — optional-per-action, default OFF so existing terminals
    // are unchanged), skill/dv for that roll (fail → trace). `sell.price` is a
    // flat fixer payout. When `exfil` is absent (legacy configs) the resolver
    // (TerminalService.getExfilPolicy) defaults agent+shard ON/ungated, the
    // four new actions OFF — i.e. today's behavior. All still gated by allowExfil.
    exfil: {
      agent:   { allow: true,  require: false, skill: 'Interface', dv: 15 },
      shard:   { allow: true,  require: false, skill: 'Interface', dv: 15 },
      leak:    { allow: false, require: false, skill: 'Interface', dv: 15 },
      sell:    { allow: false, require: false, skill: 'Trading',   dv: 15, price: 500 },
      forward: { allow: false, require: false, skill: 'Interface', dv: 15 },
      wipe:    { allow: false, require: false, skill: 'Interface', dv: 15 },
      // SAVE FRAME (#37) — the camera-feed escape hatch: a live stream can't be
      // copied, but a single FRAME can. Only ever offered on a feed gallery
      // (resolveEntryExfil hides it everywhere else), so defaulting it ON is safe.
      saveFrame: { allow: true, require: false, skill: 'Electronics/Security Tech', dv: 13 },
    },
    apps: ['mail'],               // which apps exist (MVP = mail only; catalog → P2)
    formFactor: 'desktop',        // 'desktop' (MVP). 'agent' (looted-phone chrome) → Phase 3;
                                  // field kept so it can light up later without a data migration.

    // Trace timer while logged in (→ P3). duration 0 = off even when enabled.
    trace: { enabled: false, duration: 0, onComplete: 'alarm' },
  },

  TERMINAL_STATE: {
    // Per-actor independent sessions (multiplayer decision #1), keyed by actorId.
    sessions: {},                 // { [actorId]: { activeAccountId, loggedInAccounts: [], firstAccessedAt } }
    gmBypassed: false,            // GM force-unlock (mirrors shard forceDecrypt); cleared by relock
    bootPlayed: false,
    firstAccessedAt: null,
    accessCount: 0,
    // Live machine uplink (Layer 1). World-persisted — it's the MACHINE's state,
    // shared by everyone at the screen (unlike the player's per-client network).
    // currentNetworkId: '__DEFAULT__' = follow config.connection.defaultNetworkId
    // (the sentinel survives whole-state rewrites, unlike an absent key);
    // null = explicitly disconnected (LOCAL ONLY). authenticated = creds the
    // machine has "remembered" after a successful secured join.
    connection: { currentNetworkId: '__DEFAULT__', authenticated: {} },
    // Installed programs that fire on a trigger (design §3a — the resident
    // lifecycle behind PLANT / keylog / backdoor / logic-bomb). Each:
    //   { id, effectType, params, trigger:{kind,accountId?,actorId?,atMs?,action?,threshold?},
    //     provenance:{plantedBy,plantedAt,forgeQuality,sourceLabel}, stealthDV,
    //     state:'armed'|'fired'|'defused', firedAt, installedAt }
    residents: [],
  },

  ACTOR_SESSION: { loggedIn: false, keyItemUsed: false, keyItemAttempts: 0, hackAttempts: 0, lockoutUntil: null, loginAttempts: 0, hackedLayers: [], layerHackAttempts: {}, layerLockoutUntil: null },
  SCENE_NETWORK: { networkAvailability: {}, defaultNetwork: 'CITINET', deadZone: false },

  // Operator capability gate (design §5b) — WHO can use the OPERATOR tools
  // (upload / hacking). Netrunning isn't for everyone. `mode:'anyone'` (default)
  // = ungated, so nothing changes until a GM turns it on. When `'gated'`, only
  // the qualifiers the GM actually sets are evaluated (empty = not required),
  // combined by `logic`. allowGM/actors are always-pass escapes.
  OPERATOR_GATE: {
    mode: 'anyone',                    // 'anyone' | 'gated'
    logic: 'any',                      // combine the role/skill/gear checks: 'any' | 'all'
    roles: [],                         // allowed CPR role names (substring match), e.g. ['Netrunner']
    roleLogic: 'any',                  // 'any' of the listed roles | 'all'
    skill: { name: '', min: 0 },       // required skill + min rank (name '' = not required)
    itemGroups: [],                    // OR-of-AND gear groups: [['Cyberdeck','Interface Plug'],['Militech Falcon']]
                                       //   = (Cyberdeck AND Interface Plug) OR (Militech Falcon). Each item = {name,img?} or a name string.
    actors: [],                        // explicit actor-id allowlist (always pass)
    allowGM: true,                     // the GM user always operates
  },
  CORE_NETWORKS: [
    { id: 'CITINET', name: 'CitiNet', type: 'PUBLIC', isCore: true, availability: { global: true, scenes: [] }, signalStrength: 75, reliability: 90, security: { level: 'LOW', requiresAuth: false }, effects: { messageDelay: 0, traced: false, anonymity: false, canRoute: true, restrictedAccess: false, allowedRecipientNetworks: [] }, theme: { color: '#19f3f7', icon: 'fa-wifi', glitchIntensity: 0.1 }, description: 'Night City public network' },
    { id: 'CORPNET', name: 'CorpNet', type: 'CORPORATE', isCore: true, availability: { global: false, scenes: [] }, signalStrength: 95, reliability: 99, security: { level: 'HIGH', requiresAuth: true }, effects: { messageDelay: 0, traced: true, anonymity: false, canRoute: true, restrictedAccess: true, allowedRecipientNetworks: ['CORPNET', 'CITINET'] }, theme: { color: '#4488ff', icon: 'fa-building', glitchIntensity: 0 }, description: 'Corporate communications' },
    { id: 'DARKNET', name: 'DarkNet', type: 'UNDERGROUND', isCore: true, availability: { global: false, scenes: [] }, signalStrength: 50, reliability: 70, security: { level: 'NONE', requiresAuth: false }, effects: { messageDelay: 500, traced: false, anonymity: true, canRoute: true, restrictedAccess: false, allowedRecipientNetworks: [] }, theme: { color: '#00ff41', icon: 'fa-mask', glitchIntensity: 0.4 }, description: 'Underground network' },
    { id: 'GOVNET', name: 'GovNet', type: 'GOVERNMENT', isCore: true, availability: { global: false, scenes: [] }, signalStrength: 100, reliability: 99, security: { level: 'MAXIMUM', requiresAuth: true }, effects: { messageDelay: 0, traced: true, anonymity: false, canRoute: false, restrictedAccess: true, allowedRecipientNetworks: ['GOVNET'] }, theme: { color: '#ff6600', icon: 'fa-shield-halved', glitchIntensity: 0 }, description: 'Government secure comms' },
    { id: 'DATA_POOL', name: 'Data Pool', type: 'PUBLIC', isCore: true, availability: { global: true, scenes: [] }, signalStrength: 60, reliability: 80, security: { level: 'NONE', requiresAuth: false }, effects: { messageDelay: 200, traced: false, anonymity: false, canRoute: true, restrictedAccess: false, allowedRecipientNetworks: [] }, theme: { color: '#f7c948', icon: 'fa-database', glitchIntensity: 0.2 }, description: 'Public data sharing' },
  ],
});

/**
 * The themeable palette: a key → the CSS variable it writes. Everything that
 * themes a surface iterates THIS — `ThemeService.applyTheme`, the player Theme
 * Customizer's swatch grid, the terminal Theme tab's override grid and
 * `buildTerminalThemePrefs` / `buildShardThemePrefs` — so a key added here
 * reaches all of them at once.
 *
 * `border` and `textMuted` joined in 2026-09-22 with the shard palettes: shard
 * presets carry a tinted border and a tinted footer as part of their identity
 * (Arasaka's rust-red rule, NetWatch's purple), and without these two keys those
 * could not survive the move out of CSS. They were already half-present —
 * `CONTRAST_SPREAD` has tone-mapped both under these exact names since the
 * contrast slider shipped — so this closes a gap rather than opening one.
 * No THEME_PRESET defines them, so the player theme is unchanged until someone
 * sets an override; `variables.css` keeps the :root defaults they fall back to.
 */
export const COLOR_VAR_MAP = Object.freeze({
  primary: '--ncm-primary', secondary: '--ncm-secondary', accent: '--ncm-accent',
  bgDeep: '--ncm-bg-deep', bgBase: '--ncm-bg-base', bgSurface: '--ncm-bg-surface',
  bgElevated: '--ncm-bg-elevated', textPrimary: '--ncm-text-primary', textSecondary: '--ncm-text-secondary',
  textMuted: '--ncm-text-muted', border: '--ncm-border',
});

/**
 * Readability contrast tone-mapping (ThemeService.applyTheme).
 * Instead of a CSS contrast() filter (which distorts images and drifts
 * saturation), we spread the lightness of the background/text/border palette
 * in OKLCH space around `pivot`. Accents (primary/secondary/accent) are
 * deliberately excluded so the neon identity holds at every contrast level.
 * `base` is the fallback value when neither player prefs nor the preset define
 * the color — it mirrors the variables.css default, so textMuted/border (which
 * no preset defines) still respond to the slider.
 */
export const CONTRAST_SPREAD = Object.freeze({
  pivot: 0.42,
  vars: Object.freeze([
    { cssVar: '--ncm-bg-deep',        key: 'bgDeep',        base: '#0a0a0f' },
    { cssVar: '--ncm-bg-base',        key: 'bgBase',        base: '#12121a' },
    { cssVar: '--ncm-bg-surface',     key: 'bgSurface',     base: '#1a1a2e' },
    { cssVar: '--ncm-bg-elevated',    key: 'bgElevated',    base: '#252540' },
    { cssVar: '--ncm-text-primary',   key: 'textPrimary',   base: '#ededf0' },
    { cssVar: '--ncm-text-secondary', key: 'textSecondary', base: '#bdbdd0' },
    { cssVar: '--ncm-text-muted',     key: 'textMuted',     base: '#8e8ea8' },
    { cssVar: '--ncm-border',         key: 'border',        base: '#2a2a45' },
  ]),
});

/**
 * Available font options for the Theme Customizer.
 * Each entry: { key, label, family (CSS value), google (Google Fonts param) }
 * `google: null` means font is bundled / system-available, no CDN load needed.
 */
export const FONT_OPTIONS = Object.freeze([
  { key: 'aldrich', label: 'Aldrich', family: "'Aldrich', sans-serif", google: 'Aldrich' },
  { key: 'audiowide', label: 'Audiowide', family: "'Audiowide', sans-serif", google: 'Audiowide' },
  { key: 'barlowcondensed', label: 'Barlow Condensed', family: "'Barlow Condensed', sans-serif", google: 'Barlow+Condensed:wght@400;500;600;700' },
  { key: 'blackopsone', label: 'Black Ops One', family: "'Black Ops One', sans-serif", google: 'Black+Ops+One' },
  { key: 'chakrapetch', label: 'Chakra Petch', family: "'Chakra Petch', sans-serif", google: 'Chakra+Petch:wght@400;500;600;700' },
  { key: 'electrolize', label: 'Electrolize', family: "'Electrolize', sans-serif", google: 'Electrolize' },
  { key: 'exo2', label: 'Exo 2', family: "'Exo 2', sans-serif", google: 'Exo+2:wght@400;500;600;700' },
  { key: 'firacode', label: 'Fira Code', family: "'Fira Code', monospace", google: 'Fira+Code:wght@400;500;600;700' },
  { key: 'ibmplexmono', label: 'IBM Plex Mono', family: "'IBM Plex Mono', monospace", google: 'IBM+Plex+Mono:wght@400;500;600;700' },
  { key: 'jetbrains', label: 'JetBrains Mono', family: "'JetBrains Mono', monospace", google: 'JetBrains+Mono:wght@400;500;600;700' },
  { key: 'jost', label: 'Jost', family: "'Jost', sans-serif", google: 'Jost:wght@400;500;600;700' },
  { key: 'jura', label: 'Jura', family: "'Jura', sans-serif", google: 'Jura:wght@400;500;600;700' },
  { key: 'michroma', label: 'Michroma', family: "'Michroma', sans-serif", google: 'Michroma' },
  { key: 'orbitron', label: 'Orbitron', family: "'Orbitron', sans-serif", google: null },
  { key: 'oxanium', label: 'Oxanium', family: "'Oxanium', sans-serif", google: 'Oxanium:wght@400;500;600;700' },
  { key: 'play', label: 'Play', family: "'Play', sans-serif", google: 'Play:wght@400;700' },
  { key: 'quantico', label: 'Quantico', family: "'Quantico', sans-serif", google: 'Quantico:wght@400;700' },
  { key: 'rajdhani', label: 'Rajdhani', family: "'Rajdhani', sans-serif", google: null },
  { key: 'robotomono', label: 'Roboto Mono', family: "'Roboto Mono', monospace", google: 'Roboto+Mono:wght@400;500;600;700' },
  { key: 'saira', label: 'Saira', family: "'Saira', sans-serif", google: 'Saira:wght@400;500;600;700' },
  { key: 'sharetechmono', label: 'Share Tech Mono', family: "'Share Tech Mono', monospace", google: null },
  { key: 'sourcecodepro', label: 'Source Code Pro', family: "'Source Code Pro', monospace", google: 'Source+Code+Pro:wght@400;500;600;700' },
  { key: 'spacemono', label: 'Space Mono', family: "'Space Mono', monospace", google: 'Space+Mono:wght@400;700' },
  { key: 'teko', label: 'Teko', family: "'Teko', sans-serif", google: 'Teko:wght@400;500;600;700' },
  { key: 'vt323', label: 'VT323', family: "'VT323', monospace", google: 'VT323' },
]);
