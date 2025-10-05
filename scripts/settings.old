/**
 * Settings for the Night City Messenger module
 */
import { MODULE_ID } from './constants.js';

/**
 * Register all module settings
 */
export function registerSettings() {
  // Default domain setting
  game.settings.register(MODULE_ID, 'defaultDomain', {
    name: 'Default Email Domain',
    hint: 'The default domain used when generating email addresses for characters',
    scope: 'world',
    config: true,
    type: String,
    default: 'nightcity.net'
  });

  

  // Default encryption DV
  game.settings.register(MODULE_ID, 'defaultEncryptionDV', {
    name: 'Default Encryption DV',
    hint: 'The default difficulty value for decrypting data shards',
    scope: 'world',
    config: true,
    type: Number,
    default: 15,
    range: {
      min: 10,
      max: 30,
      step: 1
    }
  });

  // Default decryption skill
  game.settings.register(MODULE_ID, 'defaultDecryptionSkill', {
    name: 'Default Decryption Skill',
    hint: 'The default skill used for decryption checks',
    scope: 'world',
    config: true,
    type: String,
    default: 'Interface',
    choices: {
      'Interface': 'Interface',
      'ElectronicsSecurity': 'Electronics/Security Tech',
      'Cryptography': 'Cryptography',
      'Education': 'Education'
    }
  });

  // Default failure outcome
  game.settings.register(MODULE_ID, 'defaultFailureOutcome', {
    name: 'Default Failure Outcome',
    hint: 'What happens when a decryption attempt fails',
    scope: 'world',
    config: true,
    type: String,
    default: 'none',
    choices: {
      'none': 'No Effect',
      'lockout': 'Lockout (5 min)',
      'traceback': 'Traceback Alert',
      'damage': 'Feedback Damage',
      'corrupt': 'Corrupt Message'
    }
  });

  // Data Shard Folder Location
  game.settings.register(MODULE_ID, 'dataShardFolderLocation', {
    name: 'Data Shard Storage Location',
    hint: 'Where to store Data Shard contents in the journal entries',
    scope: 'world',
    config: true,
    type: String,
    default: 'Data Shard Contents',
  });

  // Enable sounds setting
  game.settings.register(MODULE_ID, 'enableSounds', {
    name: 'Enable Sound Effects',
    hint: 'Play sound effects when opening/closing messages and receiving notifications',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true
  });

  // Message notification setting
  game.settings.register(MODULE_ID, 'enableNotifications', {
    name: 'Enable Notifications',
    hint: 'Show notifications when receiving new messages',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true
  });

  // GM can send as any character
  game.settings.register(MODULE_ID, 'gmCanSendAsAny', {
    name: 'GM Can Send as Any Character',
    hint: 'Allow GMs to send messages as any character or create custom senders',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // Messages per page
  game.settings.register(MODULE_ID, 'messagesPerPage', {
    name: 'Messages Per Page',
    hint: 'Number of messages to display per page in the inbox',
    scope: 'client',
    config: true,
    type: Number,
    default: 10,
    range: {
      min: 5,
      max: 30,
      step: 5
    }
  });

  // GM receives all notifications
  game.settings.register(MODULE_ID, 'gmReceivesAllNotifications', {
    name: 'GM Receives All Notifications',
    hint: 'Show the GM notifications for all messages sent between players',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true
  });

  // Enable spam generation
  game.settings.register(MODULE_ID, 'enableSpamGeneration', {
    name: 'Enable Spam Generation',
    hint: 'Periodically generate spam messages for a more immersive experience',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // Spam frequency
  game.settings.register(MODULE_ID, 'spamFrequency', {
    name: 'Spam Frequency',
    hint: 'How often spam messages are generated (in game days)',
    scope: 'world',
    config: true,
    type: Number,
    default: 3,
    range: {
      min: 1,
      max: 7,
      step: 1
    }
  });

  // Scheduled messages setting (hidden from config)
  game.settings.register(MODULE_ID, 'scheduledMessages', {
    name: 'Scheduled Messages',
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  // Auto-create journals for characters
  game.settings.register(MODULE_ID, 'autoCreateJournals', {
    name: 'Auto-create Message Journals',
    hint: 'Automatically create message journals for new player characters',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // Message retention (days)
  game.settings.register(MODULE_ID, 'messageRetention', {
    name: 'Message Retention Period',
    hint: 'Number of days to keep messages in trash before permanent deletion (0 = keep forever)',
    scope: 'world',
    config: true,
    type: Number,
    default: 30,
    range: {
      min: 0,
      max: 90,
      step: 1
    }
  });

  // Debug mode
  game.settings.register(MODULE_ID, 'debugMode', {
    name: 'Debug Mode',
    hint: 'Enable debug logging for troubleshooting',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false
  });
}

/**
 * Get a module setting
 * @param {string} key - Setting key
 * @returns {any} Setting value
 */
export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

/**
 * Set a module setting
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 * @returns {Promise} Promise that resolves when the setting is updated
 */
export function setSetting(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}