/**
 * Constants
 * File: scripts/utils/constants.js
 * Module: cyberpunkred-messenger
 * Description: Module-wide constants and configuration
 */

/**
 * Module ID - must match module.json id
 */
export const MODULE_ID = 'cyberpunkred-messenger';

/**
 * Module display name
 */
export const MODULE_NAME = 'Night City Messenger';

/**
 * Template paths for Handlebars templates
 */
export const TEMPLATES = {
  // Message Viewer
  VIEWER: `modules/${MODULE_ID}/templates/message-viewer/viewer.hbs`,
  MESSAGE_LIST: `modules/${MODULE_ID}/templates/message-viewer/partials/message-list.hbs`,
  MESSAGE_ITEM: `modules/${MODULE_ID}/templates/message-viewer/partials/message-item.hbs`,
  MESSAGE_DETAIL: `modules/${MODULE_ID}/templates/message-viewer/partials/message-detail.hbs`,
  FILTERS_PANEL: `modules/${MODULE_ID}/templates/message-viewer/partials/filters-panel.hbs`,
  
  // Message Composer
  COMPOSER: `modules/${MODULE_ID}/templates/message-composer/composer.hbs`,
  RECIPIENT_FIELD: `modules/${MODULE_ID}/templates/message-composer/partials/recipient-field.hbs`,
  EDITOR: `modules/${MODULE_ID}/templates/message-composer/partials/editor.hbs`,
  SCHEDULING_PANEL: `modules/${MODULE_ID}/templates/message-composer/partials/scheduling-panel.hbs`,
  
  // Contact Manager
  CONTACT_MANAGER: `modules/${MODULE_ID}/templates/contact-manager/contact-manager.hbs`,
  
  // Admin Panel
  ADMIN_PANEL: `modules/${MODULE_ID}/templates/admin-panel/admin-panel.hbs`,
  STATISTICS: `modules/${MODULE_ID}/templates/admin-panel/partials/statistics.hbs`,
  USER_MANAGEMENT: `modules/${MODULE_ID}/templates/admin-panel/partials/user-management.hbs`,
  SYSTEM_TOOLS: `modules/${MODULE_ID}/templates/admin-panel/partials/system-tools.hbs`,
  
  // Item Inbox
  ITEM_INBOX: `modules/${MODULE_ID}/templates/item-inbox/item-inbox.hbs`,
  ITEM_CONFIG: `modules/${MODULE_ID}/templates/item-inbox/item-config.hbs`,
  MESSAGE_SHARED: `modules/${MODULE_ID}/templates/item-inbox/message-shared.hbs`,
  HACK_RESULT: `modules/${MODULE_ID}/templates/item-inbox/hack-result.hbs`,
  
  // Shared
  SHARED_MESSAGE: `modules/${MODULE_ID}/templates/shared/message-shared.hbs`,
  NOTIFICATION: `modules/${MODULE_ID}/templates/shared/notification.hbs`
};

/**
 * Folder names for organization
 */
export const FOLDERS = {
  ROOT: 'Night City Messages',
  INBOXES: 'User Inboxes',
  CONTACTS: 'Contacts',
  DELETED: 'Deleted Messages',
  SPAM: 'Spam',
  DRAFTS: 'Drafts'
};

/**
 * Message status constants
 */
export const MESSAGE_STATUS = {
  UNREAD: 'unread',
  READ: 'read',
  SAVED: 'saved',
  SPAM: 'spam',
  DELETED: 'deleted',
  DRAFT: 'draft'
};

/**
 * Network types
 */
export const NETWORKS = {
  CITINET: 'CITINET',
  CORPNET: 'CORPNET',
  DARKNET: 'DARKNET',
  DEAD_ZONE: 'DEAD_ZONE'
};

/**
 * Network reliability percentages
 */
export const NETWORK_RELIABILITY = {
  [NETWORKS.CITINET]: 95,
  [NETWORKS.CORPNET]: 99,
  [NETWORKS.DARKNET]: 85,
  [NETWORKS.DEAD_ZONE]: 0
};

/**
 * Network Types
 */
export const NETWORK_TYPES = [
  { value: 'DEFAULT', label: 'Default Network' },
  { value: 'CUSTOM', label: 'Custom Network' }
];

/**
 * Network Security Levels
 */
export const SECURITY_LEVELS = [
  { value: 'NONE', label: 'None' },
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'EXTREME', label: 'Extreme' }
];

/**
 * Encryption types
 */
export const ENCRYPTION_TYPES = {
  ICE: 'ICE',
  BLACK_ICE: 'BLACK_ICE',
  RED_ICE: 'RED_ICE',
  CUSTOM: 'CUSTOM'
};

/**
 * Default encryption DCs by type
 */
export const ENCRYPTION_DCS = {
  [ENCRYPTION_TYPES.ICE]: 15,
  [ENCRYPTION_TYPES.BLACK_ICE]: 20,
  [ENCRYPTION_TYPES.RED_ICE]: 25,
  [ENCRYPTION_TYPES.CUSTOM]: 15
};

/**
 * BLACK ICE damage rolls
 */
export const BLACK_ICE_DAMAGE = {
  [ENCRYPTION_TYPES.BLACK_ICE]: '5d6',
  [ENCRYPTION_TYPES.RED_ICE]: '8d6'
};

/**
 * Malware types
 */
export const MALWARE_TYPES = {
  VIRUS: 'virus',
  WORM: 'worm',
  TROJAN: 'trojan',
  SPYWARE: 'spyware',
  RANSOMWARE: 'ransomware'
};

/**
 * Failure outcomes for decryption attempts
 */
export const FAILURE_OUTCOMES = {
  LOCKED: 'locked',            // Just stays locked
  BLACK_ICE: 'blackice',       // Takes damage
  CORRUPTED: 'corrupted',      // Messages deleted
  TRACED: 'traced',            // NetWatch notified
  DISABLED: 'disabled'         // Item disabled for X time
};

/**
 * Skills available for decryption checks
 */
export const DECRYPTION_SKILLS = {
  INTERFACE: 'Interface',
  ELECTRONICS_SECURITY: 'ElectronicsSecurity',
  BASIC_TECH: 'BasicTech',
  EDUCATION: 'Education'
};

/**
 * Themes
 */
export const THEMES = {
  CLASSIC: 'classic',
  NEON: 'neon',
  CORPORATE: 'corporate',
  MINIMAL: 'minimal',
  HIGH_CONTRAST: 'high-contrast',
  RETRO: 'retro'
};

/**
 * Permission levels
 */
export const PERMISSIONS = {
  NONE: 0,
  LIMITED: 1,
  OBSERVER: 2,
  OWNER: 3
};

/**
 * Sort options for message lists
 */
export const SORT_OPTIONS = {
  DATE_DESC: 'date-desc',
  DATE_ASC: 'date-asc',
  SENDER_AZ: 'sender-az',
  SENDER_ZA: 'sender-za',
  SUBJECT_AZ: 'subject-az',
  SUBJECT_ZA: 'subject-za'
};

/**
 * Filter options
 */
export const FILTERS = {
  ALL: 'all',
  UNREAD: 'unread',
  READ: 'read',
  SAVED: 'saved',
  ENCRYPTED: 'encrypted',
  MALWARE: 'malware',
  SPAM: 'spam'
};

/**
 * Pagination settings
 */
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  PAGE_SIZE_OPTIONS: [10, 20, 50, 100]
};

/**
 * Character limits
 */
export const LIMITS = {
  SUBJECT_MAX_LENGTH: 200,
  MESSAGE_MAX_LENGTH: 10000,
  CONTACT_NAME_MAX_LENGTH: 100,
  EMAIL_MAX_LENGTH: 255
};

/**
 * Time constants (in milliseconds)
 */
export const TIME = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000
};

/**
 * Scheduling options
 */
export const SCHEDULING = {
  CHECK_INTERVAL: 1 * TIME.MINUTE,  // Check every minute for scheduled messages
  MAX_FUTURE_DAYS: 365               // Can't schedule more than 1 year ahead
};

/**
 * Animation durations (in milliseconds)
 */
export const ANIMATIONS = {
  FAST: 150,
  NORMAL: 300,
  SLOW: 500
};

/**
 * Contact categories
 */
export const CONTACT_CATEGORIES = {
  ALL: 'all',
  FRIENDS: 'friends',
  FIXERS: 'fixers',
  CORPO: 'corpo',
  CREW: 'crew',
  MEDIA: 'media',
  NETRUNNER: 'netrunner',
  SOLO: 'solo',
  TECH: 'tech',
  ROCKERBOY: 'rockerboy',
  NOMAD: 'nomad',
  MEDTECH: 'medtech',
  LAWMAN: 'lawman',
  EXEC: 'exec',
  FIXER: 'fixer',
  CUSTOM: 'custom'
};

/**
 * Data shard types (item types that can be inboxes)
 */
export const DATA_SHARD_TYPES = [
  'cyberdeck',
  'cyberware',
  'gear',
  'weapon',
  'armor',
  'vehicle',
  'drug'
];

/**
 * Export formats
 */
export const EXPORT_FORMATS = {
  JOURNAL: 'journal',
  ITEM: 'item',
  JSON: 'json',
  TEXT: 'text'
};

/**
 * Notification types
 */
export const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error'
};

/**
 * Notification durations (in milliseconds)
 */
export const NOTIFICATION_DURATION = {
  SHORT: 3000,
  NORMAL: 5000,
  LONG: 8000,
  PERMANENT: 0
};

/**
 * Comprehensive skills for Cyberpunk RED
 * Organized by category for UI purposes
 * IMPORTANT: These use the actual skill names as they appear on character sheets
 */
export const CYBERPUNK_SKILLS = {
  // Tech Skills - Most relevant for hacking
  TECH: {
    Interface: { 
      name: 'Interface', 
      displayName: 'Interface',
      stat: 'INT',
      description: 'Primary netrunning skill'
    },
    ElectronicsSecurity: { 
      name: 'Electronics/Security Tech', 
      displayName: 'Electronics/Security Tech',
      stat: 'TECH',
      description: 'Hardware hacking and security systems'
    },
    BasicTech: { 
      name: 'Basic Tech', 
      displayName: 'Basic Tech',
      stat: 'TECH',
      description: 'General technical knowledge'
    },
    Cybertech: { 
      name: 'Cybertech', 
      displayName: 'Cybertech',
      stat: 'TECH',
      description: 'Cyberware installation and repair'
    },
    FirstAid: { 
      name: 'First Aid', 
      displayName: 'First Aid',
      stat: 'TECH',
      description: 'Medical treatment'
    },
    Forgery: { 
      name: 'Forgery', 
      displayName: 'Forgery',
      stat: 'TECH',
      description: 'Creating false documents'
    },
    PickLock: { 
      name: 'Pick Lock', 
      displayName: 'Pick Lock',
      stat: 'TECH',
      description: 'Physical lock bypassing'
    },
    Weaponstech: { 
      name: 'Weaponstech', 
      displayName: 'Weaponstech',
      stat: 'TECH',
      description: 'Weapon maintenance and repair'
    }
  },
  
  // Intelligence Skills - Alternative approaches
  INTELLIGENCE: {
    Cryptography: { 
      name: 'Cryptography', 
      displayName: 'Cryptography',
      stat: 'INT',
      description: 'Code breaking and encryption'
    },
    Deduction: { 
      name: 'Deduction', 
      displayName: 'Deduction',
      stat: 'INT',
      description: 'Logical reasoning and pattern recognition'
    },
    Education: { 
      name: 'Education', 
      displayName: 'Education',
      stat: 'INT',
      description: 'General knowledge'
    },
    LibrarySearch: { 
      name: 'Library Search', 
      displayName: 'Library Search',
      stat: 'INT',
      description: 'Research and information gathering'
    },
    LocalExpert: { 
      name: 'Local Expert', 
      displayName: 'Local Expert',
      stat: 'INT',
      description: 'Area-specific knowledge'
    },
    Science: { 
      name: 'Science', 
      displayName: 'Science',
      stat: 'INT',
      description: 'Scientific knowledge'
    },
    Tactics: { 
      name: 'Tactics', 
      displayName: 'Tactics',
      stat: 'INT',
      description: 'Strategic thinking'
    },
    Perception: { 
      name: 'Perception', 
      displayName: 'Perception',
      stat: 'INT',
      description: 'Awareness and observation'
    }
  }
};

/**
 * Preset skill combinations for different tasks
 * Uses actual Cyberpunk RED skill names as they appear on character sheets
 */
export const SKILL_PRESETS = {
  // Hacking data shards
  HACKING: {
    primary: ['Interface', 'Electronics/Security Tech'],
    secondary: ['Basic Tech', 'Cryptography'],
    description: 'Breach encrypted systems'
  },
  
  // Authentication bypass
  AUTHENTICATION: {
    primary: ['Interface', 'Electronics/Security Tech'],
    secondary: ['Library Search', 'Deduction', 'Education'],
    description: 'Crack passwords and credentials'
  },
  
  // Data recovery
  RECOVERY: {
    primary: ['Basic Tech', 'Cybertech'],
    secondary: ['Interface', 'Electronics/Security Tech'],
    description: 'Recover corrupted data'
  },
  
  // Cryptanalysis
  CRYPTANALYSIS: {
    primary: ['Cryptography', 'Interface'],
    secondary: ['Education', 'Science'],
    description: 'Break encryption algorithms'
  },
  
  // Social engineering (for password guessing)
  SOCIAL_ENGINEERING: {
    primary: ['Deduction', 'Local Expert'],
    secondary: ['Education', 'Library Search', 'Human Perception'],
    description: 'Guess passwords through knowledge'
  }
};

/**
 * Difficulty Classes for skill checks
 */
export const DIFFICULTY = {
  EASY: 9,
  AVERAGE: 13,
  DIFFICULT: 15,
  VERY_DIFFICULT: 17,
  NEARLY_IMPOSSIBLE: 21,
  IMPOSSIBLE: 29
};

/**
 * Default settings for data shards
 */
export const DEFAULTS = {
  ENCRYPTION_DC: 15,
  ENCRYPTION_TYPE: 'ICE',
  FAILURE_MODE: 'lockout',
  THEME: 'classic',
  ALLOWED_SKILLS: ['Interface', 'Electronics/Security Tech'], // Use actual skill names from CPR
  MAX_HACK_ATTEMPTS: 3,
  LOCKOUT_DURATION: 3600000 // 1 hour in milliseconds
};

/**
 * API version
 */
export const API_VERSION = '2.0.0';

/**
 * Debug mode (set via module settings)
 */
export let DEBUG_MODE = false;

/**
 * Set debug mode
 * @param {boolean} enabled - Whether debug mode is enabled
 */
export function setDebugMode(enabled) {
  DEBUG_MODE = enabled;
}

/**
 * Log debug message (only if debug mode is enabled)
 * @param {...any} args - Arguments to log
 */
export function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log(`${MODULE_ID} | [DEBUG]`, ...args);
  }
}