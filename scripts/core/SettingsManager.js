/**
 * SettingsManager — FoundryVTT Settings Registration & Access
 * @file scripts/core/SettingsManager.js
 * @module cyberpunkred-messenger
 * @description Singleton that registers all module settings and provides
 *              typed getter/setter access. Wraps game.settings.
 */

import { MODULE_ID, DEFAULTS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class SettingsManager {
  static #instance = null;

  static getInstance() {
    if (!SettingsManager.#instance) {
      SettingsManager.#instance = new SettingsManager();
    }
    return SettingsManager.#instance;
  }

  constructor() {
    if (SettingsManager.#instance) {
      throw new Error('SettingsManager is a singleton — use SettingsManager.getInstance()');
    }
    this._registered = false;
  }

  /**
   * Register all module settings. Called once during init hook.
   */
  registerAll() {
    if (this._registered) return;
    log.info('Registering settings...');

    // ─── World Settings (GM only) ───

    game.settings.register(MODULE_ID, 'customNetworks', {
      name: 'NCM.Settings.CustomNetworks.Name',
      hint: 'NCM.Settings.CustomNetworks.Hint',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'coreNetworkOverrides', {
      name: 'NCM.Settings.CoreNetworkOverrides.Name',
      hint: 'GM overrides for core network settings (security, effects, theme).',
      scope: 'world',
      config: false,
      type: Object,
      default: {},
    });

    game.settings.register(MODULE_ID, 'scheduledMessages', {
      name: 'NCM.Settings.ScheduledMessages.Name',
      hint: 'NCM.Settings.ScheduledMessages.Hint',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'networkAccessLog', {
      name: 'NCM.Settings.NetworkAccessLog.Name',
      hint: 'Persistent network access log entries.',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'masterContacts', {
      name: 'NCM.Settings.MasterContacts.Name',
      hint: 'NCM.Settings.MasterContacts.Hint',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'customRoles', {
      name: 'NCM.Settings.CustomRoles.Name',
      hint: 'GM-defined custom contact roles with custom icons and colors.',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'requireContactVerification', {
      name: 'NCM.Settings.RequireContactVerification',
      hint: 'NCM.Settings.RequireContactVerificationHint',
      scope: 'world',       // GM-controlled, affects all players
      config: true,          // Visible in module settings
      type: Boolean,
      default: true,
      onChange: () => {
        // Refresh any open contact managers
        game.nightcity?.eventBus?.emit(EVENTS.CONTACTS_REVERIFIED);
      },
    });

    game.settings.register(MODULE_ID, 'subjectThreading', {
      name: 'NCM.Settings.SubjectThreading',
      hint: 'NCM.Settings.SubjectThreadingHint',
      scope: 'world',       // GM-controlled, affects how conversations group for everyone
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'notifyGmNpcMail', {
      name: 'GM Alert — Player Mail to NPCs',
      hint: 'Show the GM a toast notification whenever a player sends a message to an NPC. The NPC Inbox section in Admin → Messages is always available regardless of this setting.',
      scope: 'world',        // GM-facing; world-scoped so all GMs share it
      config: true,
      type: Boolean,
      default: true,
    });

    // ─── Unknown-Sender Spam Filtering ───
    // When a message arrives from someone the player hasn't added as a contact,
    // it has a configurable chance of landing in Spam instead of the Inbox —
    // nudging players to check their spam folder and add their contacts.

    game.settings.register(MODULE_ID, 'spamUnknownSenderEnabled', {
      name: 'Spam Filter — Unknown Senders',
      hint: 'When ON, messages to players from senders they have NOT added as a contact may be routed to the Spam folder instead of the Inbox (silent — no new-message toast). Encourages players to check spam and save contacts.',
      scope: 'world',
      config: true,
      type: Boolean,
      default: false,
    });

    game.settings.register(MODULE_ID, 'spamUnknownSenderChance', {
      name: 'Spam Filter — Chance (%)',
      hint: 'Percent chance an eligible message from an un-added sender is routed to Spam. 0 = never, 100 = always.',
      scope: 'world',
      config: true,
      type: Number,
      range: { min: 0, max: 100, step: 5 },
      default: 25,
    });

    game.settings.register(MODULE_ID, 'spamUnknownSenderScope', {
      name: 'Spam Filter — Sender Scope',
      hint: 'Which un-added senders are eligible. "Known contacts only" = the sender exists in the Master Directory / is a registered character but the player hasn\'t added them ("a contact exists but isn\'t added"). "Any un-added sender" = also includes completely unknown addresses.',
      scope: 'world',
      config: true,
      type: String,
      default: 'known',
      choices: {
        known: 'Known contacts only',
        all: 'Any un-added sender',
      },
    });

    game.settings.register(MODULE_ID, 'spamUnknownSenderExcludePlayers', {
      name: 'Spam Filter — Exclude Player Senders',
      hint: 'When ON, messages from other player characters are never spam-filtered (keeps party comms out of spam). Only NPC / contact senders are eligible.',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    // ─── Time Provider Settings ───

    game.settings.register(MODULE_ID, 'dateFormat', {
      name: 'NCM.Settings.DateFormat.Name',
      hint: 'How dates are displayed across all NCM windows.',
      scope: 'world',
      config: true,
      type: String,
      default: 'YMD',
      choices: {
        YMD: 'YYYY.MM.DD',
        DMY: 'DD.MM.YYYY',
        MDY: 'MM.DD.YYYY',
      },
    });

    game.settings.register(MODULE_ID, 'dateMonthStyle', {
      name: 'Date — Month Style',
      hint: 'Render the month as a number (03), short name (Mar), or full name (March) across all NCM dates. Composes with the date order above — e.g. with MM.DD.YYYY + Full = "March 18, 2045".',
      scope: 'world',
      config: true,
      type: String,
      default: 'number',
      choices: {
        number: 'Number (03)',
        short: 'Short name (Mar)',
        long: 'Full name (March)',
      },
    });

    game.settings.register(MODULE_ID, 'timeFormat', {
      name: 'NCM.Settings.TimeFormat.Name',
      hint: 'Display times in 24-hour (22:00) or 12-hour (10:00 PM) format across all NCM windows.',
      scope: 'world',
      config: true,
      type: String,
      default: '24h',
      choices: {
        '24h': '24-Hour (22:00)',
        '12h': '12-Hour (10:00 PM)',
      },
    });

    game.settings.register(MODULE_ID, 'timeProvider', {
      name: 'NCM.Settings.TimeProvider.Name',
      hint: 'How NCM determines in-game time. Auto-detect picks the best available module. Disguised runs real-time but displays a fictional date.',
      scope: 'world',
      config: true,
      type: String,
      default: 'auto',
      choices: {
        auto: 'Auto-Detect',
        'simple-calendar': 'SimpleCalendar',
        'world-time': 'Foundry World Time',
        'real-time': 'Real-World Time',
        'manual': 'Manual (GM Set)',
        'disguised': 'Disguised Time',
      },
      onChange: (value) => {
        const ts = game.nightcity?.timeService;
        if (ts) {
          ts._mode = value;
          if (value === 'auto') ts._autoResolved = ts._detectBestProvider();
          log.info(`TimeService: Mode changed via settings to ${value}`);
        }
      },
    });

    game.settings.register(MODULE_ID, 'disguisedBaseTime', {
      name: 'Disguised Base Time',
      hint: 'The fictional date/time that the disguised clock started from.',
      scope: 'world',
      config: false,
      type: String,
      default: '',
    });

    game.settings.register(MODULE_ID, 'disguisedAnchor', {
      name: 'Disguised Anchor',
      hint: 'Real-world timestamp (ms) when the disguised base was set.',
      scope: 'world',
      config: false,
      type: Number,
      default: 0,
    });

    game.settings.register(MODULE_ID, 'manualTime', {
      name: 'Manual Time',
      hint: 'The GM-set manual timestamp.',
      scope: 'world',
      config: false,
      type: String,
      default: '',
    });

    // ─── Email Identity Settings ───

    game.settings.register(MODULE_ID, 'emailDomains', {
      name: 'NCM.Settings.EmailDomains.Name',
      hint: 'List of available email domains (managed via Admin Panel).',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'emailSetupRequired', {
      name: 'Require Email Setup',
      hint: 'Players must register a NET identity before using NCM messaging.',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'emailAllowPlayerBurn', {
      name: 'Allow Player Identity Burn',
      hint: 'Players can burn and re-register their own NET identity.',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'emailAllowCustomDomains', {
      name: 'Allow Custom Domains',
      hint: 'Players can type a custom domain instead of picking from the network list.',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'emailDefaultDomain', {
      name: 'Default Email Domain',
      hint: 'Fallback domain when no network domains are configured.',
      scope: 'world',
      config: true,
      type: String,
      default: 'nightcity.net',
    });

    // ─── Data Shard Conversion Settings ───

    game.settings.register(MODULE_ID, 'playerShardFloor', {
      name: 'Player Shard Creation Floor',
      hint: 'Minimum tier all players can access. Character skills can unlock higher tiers beyond this floor.',
      scope: 'world',
      config: true,
      type: String,
      default: 'disabled',
      choices: {
        disabled: 'Disabled — GM only',
        basic: 'Basic — message-only shards',
        mid: 'Mid — password + standard ICE',
        full: 'Full — simplified GM config',
      },
    });

    game.settings.register(MODULE_ID, 'playerShardSkill', {
      name: 'Shard Encoding Skill',
      hint: 'CPR skill that determines tier upgrades beyond the floor. Skill rank thresholds: 0-3 Basic, 4-6 Mid, 7+ Full.',
      scope: 'world',
      config: true,
      type: String,
      default: 'interface',
    });

    game.settings.register(MODULE_ID, 'playerBlackICE', {
      name: 'Allow Player BLACK/RED ICE',
      hint: 'Whether Full tier players can use BLACK ICE and RED ICE on their shards. Disable to restrict players to standard ICE only.',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'debugMode', {
      name: 'NCM.Settings.DebugMode.Name',
      hint: 'NCM.Settings.DebugMode.Hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: false,
    });

    // ─── Client Settings (per-player) ───

    game.settings.register(MODULE_ID, 'playerTheme', {
      name: 'NCM.Settings.PlayerTheme.Name',
      hint: 'NCM.Settings.PlayerTheme.Hint',
      scope: 'client',
      config: false,
      type: Object,
      default: foundry.utils.deepClone(DEFAULTS.PLAYER_THEME),
    });

    game.settings.register(MODULE_ID, 'customPresets', {
      name: 'NCM.Settings.CustomPresets.Name',
      hint: 'User-saved custom theme presets.',
      scope: 'client',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'adminTheme', {
      name: 'NCM.Settings.AdminTheme.Name',
      hint: 'Appearance of the GM Admin Panel (separate from the player theme).',
      scope: 'client',
      config: false,
      type: Object,
      default: foundry.utils.deepClone(DEFAULTS.ADMIN_THEME),
    });

    this._registered = true;
    log.info('Settings registered');
  }

  /**
   * Get a setting value
   * @param {string} key
   * @returns {*}
   */
  get(key) {
    return game.settings.get(MODULE_ID, key);
  }

  /**
   * Set a setting value
   * @param {string} key
   * @param {*} value
   */
  async set(key, value) {
    return game.settings.set(MODULE_ID, key, value);
  }

  /**
   * Get player theme preferences (convenience)
   * @returns {object}
   */
  getTheme() {
    return this.get('playerTheme');
  }

  /**
   * Update player theme (merges with existing)
   * @param {object} updates
   */
  async setTheme(updates) {
    const current = this.getTheme();
    const merged = foundry.utils.mergeObject(current, updates, { inplace: false });
    return this.set('playerTheme', merged);
  }

  /**
   * Get GM Admin Panel theme preferences (separate from player theme).
   * @returns {object}
   */
  getAdminTheme() {
    try { return this.get('adminTheme'); } catch { return foundry.utils.deepClone(DEFAULTS.ADMIN_THEME); }
  }

  /**
   * Update the admin theme (merges with existing).
   * @param {object} updates
   */
  async setAdminTheme(updates) {
    const current = this.getAdminTheme();
    const merged = foundry.utils.mergeObject(current, updates, { inplace: false });
    return this.set('adminTheme', merged);
  }
}
