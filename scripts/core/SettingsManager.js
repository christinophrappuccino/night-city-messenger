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
      hint: 'Domain configuration per network (managed via Admin Panel).',
      scope: 'world',
      config: false,
      type: Object,
      default: {},
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
}
