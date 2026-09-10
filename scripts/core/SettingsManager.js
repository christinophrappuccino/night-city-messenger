/**
 * SettingsManager — FoundryVTT Settings Registration & Access
 * @file scripts/core/SettingsManager.js
 * @module night-city-messenger
 * @description Singleton that registers all module settings and provides
 *              typed getter/setter access. Wraps game.settings.
 */

import { MODULE_ID, DEFAULTS, SKILL_MAP } from '../utils/constants.js';
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

    // CPR skill choices for skill-picker settings (built from the canonical
    // SKILL_MAP; keys are proper-case skill names, grouped by stat category).
    const skillChoices = Object.fromEntries(Object.keys(SKILL_MAP).map(s => [s, s]));

    // ─── World Settings (GM only) ───

    game.settings.register(MODULE_ID, 'customNetworks', {
      name: 'Custom Networks',
      hint: 'GM-defined custom networks',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'coreNetworkOverrides', {
      name: 'Core Network Overrides',
      hint: 'GM overrides for core network settings (security, effects, theme).',
      scope: 'world',
      config: false,
      type: Object,
      default: {},
    });

    game.settings.register(MODULE_ID, 'scheduledMessages', {
      name: 'Scheduled Messages',
      hint: 'Messages awaiting delivery',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'networkAccessLog', {
      name: 'Network Access Log',
      hint: 'Persistent network access log entries.',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'masterContacts', {
      name: 'Master Contact List',
      hint: 'GM global contact directory',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'customRoles', {
      name: 'Custom Contact Roles',
      hint: 'GM-defined custom contact roles with custom icons and colors.',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'requireContactVerification', {
      name: 'Require Contact Verification',
      hint: 'When enabled, players can only message contacts whose email matches the master contact directory or a registered actor. Anyone who has already messaged a character can always be answered. Disable for a more casual experience.',
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
      name: 'Smart Conversation Grouping',
      hint: 'Group messages into a conversation thread when they share a subject and a participant, in addition to replies and forwards. Catches forwarded and older messages. Disable to thread strictly by reply/forward links.',
      scope: 'world',       // GM-controlled, affects how conversations group for everyone
      config: true,
      type: Boolean,
      default: true,
    });

    // The Agent folder that catches everything exfiltrated off a terminal —
    // downloaded mail, burned intel, captured camera frames. Default **EXFIL**:
    // the action is "exfiltrate", so the destination shares its vocabulary (the
    // old "Recovered" was the only word in the flow that didn't, and it implies
    // something was LOST and found — a live-feed frame capture never was).
    // Renameable because diegetic labels vary per table, exactly like the
    // terminals' own folder names.
    game.settings.register(MODULE_ID, 'exfilFolderName', {
      name: 'Exfil Folder Name',
      hint: 'What the Agent calls the folder holding everything pulled off a terminal (downloads, burns, captured camera frames). Blank = "Exfil". Try "Salvage", "Cache", "Recovered", "The Haul"…',
      scope: 'world',
      config: true,
      type: String,
      default: 'Exfil',
    });

    game.settings.register(MODULE_ID, 'notifyGmNpcMail', {
      name: 'GM Alert — Player Mail to NPCs',
      hint: 'Show the GM a toast notification whenever a player sends a message to an NPC. The NPC Inbox section in Admin → Messages is always available regardless of this setting.',
      scope: 'world',        // GM-facing; world-scoped so all GMs share it
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'autoRegisterNpcSenders', {
      name: 'Auto-Register NPC Senders',
      hint: 'When the GM sends a message from an NPC actor that is not in the Master Contact list, add it automatically (linked to the actor, with its portrait and role) and show a notice. Players can then add and reply to that sender. Turn off to keep the directory strictly hand-curated.',
      scope: 'world',
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

    // ─── Anonymous Send (GM) ───
    // A GM-only composer option that masks the sender: the recipient sees an
    // alias + a masked avatar and CANNOT resolve the real identity (the real
    // sender is stored GM-side only). Optional trace-to-unmask minigame.

    game.settings.register(MODULE_ID, 'anonSendEnabled', {
      name: 'Anonymous Send — Enable',
      hint: 'Allow the GM to send messages anonymously from the composer. The recipient sees a masked avatar + alias and cannot resolve who sent it; the GM always sees the true sender (flagged SENT ANON).',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'anonDefaultStyle', {
      name: 'Anonymous Send — Default Mask',
      hint: 'Which avatar mask is pre-selected when the GM toggles Anonymous on. Filtered = their photo dimmed to a shadow; Scrambled = photo buried under static; Ghost = silhouette; Monolith = SEELE-style "SOUND ONLY" slab.',
      scope: 'world',
      config: true,
      type: String,
      default: 'scrambled',
      choices: {
        filtered: 'Filtered (dimmed photo)',
        scrambled: 'Scrambled (static)',
        ghost: 'Ghost (silhouette)',
        monolith: 'Monolith (SOUND ONLY)',
      },
    });

    game.settings.register(MODULE_ID, 'anonAllowRepliesDefault', {
      name: 'Anonymous Send — Allow Replies by Default',
      hint: 'When ON, anonymous messages can be replied to by default — the reply routes back to the real sender but stays masked to the player. The GM can override per message. When OFF, anonymous mail is one-way (no reply) unless enabled per message.',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'anonTraceEnabled', {
      name: 'Anonymous Send — Trace Mechanic',
      hint: 'Allow recipients to attempt to trace (unmask) an anonymous sender via a skill check. Disable to make anonymity absolute (no in-fiction way to reveal the sender).',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'anonTraceDV', {
      name: 'Anonymous Send — Trace Difficulty (DV)',
      hint: 'Default difficulty value the recipient must beat to trace an anonymous sender. The GM can override per message.',
      scope: 'world',
      config: true,
      type: Number,
      range: { min: 6, max: 30, step: 1 },
      default: 15,
    });

    game.settings.register(MODULE_ID, 'anonTraceSkill', {
      name: 'Anonymous Send — Trace Skill',
      hint: 'CPR skill the recipient rolls to trace (unmask) an anonymous sender.',
      scope: 'world',
      config: true,
      type: String,
      default: 'Interface',
      choices: skillChoices,
    });

    // ─── Time Provider Settings ───

    game.settings.register(MODULE_ID, 'dateFormat', {
      name: 'Date Format',
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
      name: 'Time Format',
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
      name: 'Time Source',
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
      name: 'Email Domains',
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
      default: 'Interface',
      choices: skillChoices,
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
      name: 'Debug Mode',
      hint: 'Enable verbose console logging',
      scope: 'world',
      config: true,
      type: Boolean,
      default: false,
    });

    // ─── Client Settings (per-player) ───

    game.settings.register(MODULE_ID, 'playerTheme', {
      name: 'Terminal Theme',
      hint: "Customize your terminal's appearance",
      scope: 'client',
      config: false,
      type: Object,
      default: foundry.utils.deepClone(DEFAULTS.PLAYER_THEME),
    });

    // The character this client is ACTING AS in the terminal / shard viewers
    // (rolls, siphon/claim target, skill + stat reads). Defaults to the user's
    // assigned character; the OPERATOR chip switches it. Client-scoped — it's
    // a per-player view choice, not world state.
    game.settings.register(MODULE_ID, 'operatorActorId', {
      name: 'Operator Character',
      hint: 'The character this client acts as in terminals and data shards.',
      scope: 'client',
      config: false,
      type: String,
      default: '',
    });

    game.settings.register(MODULE_ID, 'customPresets', {
      name: 'Custom Theme Presets',
      hint: 'User-saved custom theme presets.',
      scope: 'client',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'terminalPresetLibrary', {
      name: 'Terminal Preset Library',
      hint: 'GM-saved FULL terminal presets ([{ name, config }] — theme, boot, login style, screensaver, folders, account seeds).',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'terminalPinsAutoShow', {
      name: 'Terminal Pins — Auto-Show Map Notes',
      hint: 'Terminals dragged onto a scene become clickable map pins. Foundry hides map pins until a client enables "Toggle Display of Map Notes" (off by default); this auto-enables that toggle for everyone at login so terminal pins are always visible. Turn off to leave the core toggle alone.',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'terminalThemePresets', {
      name: 'Terminal Theme Presets',
      hint: 'GM-saved terminal themes ([{ name, theme }]) — world-scoped so one look can be reused across terminals.',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'contactsGroupBy', {
      name: 'Contacts Grouping',
      hint: 'How the Admin Contacts accordion groups contacts (role / org / trust / none). Client-scoped — each GM keeps their own view.',
      scope: 'client',
      config: false,
      type: String,
      default: 'role',
    });

    game.settings.register(MODULE_ID, 'entryTemplates', {
      name: 'Entry Templates',
      hint: 'GM-saved content-entry templates ([{ id, name, type, entry }]) — reusable typed files for shards/terminals, loadable in the composer.',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'programLibrary', {
      name: 'Program Library',
      hint: 'GM-authored programs from the Malware Workshop ([{ id, name, group, icon, program }]) — reusable malware/payload definitions, buildable onto any shard or NPC.',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'adminTheme', {
      name: 'Admin Panel Theme',
      hint: 'Appearance of the GM Admin Panel (separate from the player theme).',
      scope: 'client',
      config: false,
      type: Object,
      default: foundry.utils.deepClone(DEFAULTS.ADMIN_THEME),
    });

    // GM view: show the GM's OWN immersive windows (message viewer, composer,
    // contacts) in the admin theme + text size for readability. Toggled from
    // those windows' header menus; players are never affected.
    game.settings.register(MODULE_ID, 'gmViewAdminTheme', {
      name: 'GM View (Messenger windows in the admin theme)',
      hint: 'When on, the GM sees the message viewer, composer, and contacts in the Admin Panel theme and text size. Toggle it from those windows\' header menu to check what players see.',
      scope: 'client',
      config: false,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'operatorGate', {
      name: 'Operator Capability Gate',
      hint: 'WHO can use the OPERATOR tools (upload / hacking). Default is ungated; a GM can require a role / skill rank / gear so netrunning is limited to capable characters.',
      scope: 'world',
      config: false,
      type: Object,
      default: foundry.utils.deepClone(DEFAULTS.OPERATOR_GATE),
    });

    /*
     * HOW gated hack/upload actions resolve (design §5) — the sibling of
     * operatorGate (WHO can act). auto: roll it, self-contained (default —
     * an abstraction of netrunning). flagged: roll it, but post a GM card
     * naming the NET-action shape so the table can fold it into their run.
     * gm: don't roll — the netrunner runs the NET at the table and the GM
     * calls pass/fail (NCM is just the state layer). Edited in Admin →
     * Security next to Operator Access; per-terminal override in the
     * terminal config ('inherit' follows this).
     */
    game.settings.register(MODULE_ID, 'hackResolution', {
      name: 'Netrunning Resolution',
      hint: 'How hack/upload checks resolve: auto-roll, auto-roll + GM NET-action card, or GM-adjudicated at the table.',
      scope: 'world',
      config: false,
      type: String,
      choices: { auto: 'Auto-roll', flagged: 'Auto-roll + NET card', gm: 'GM adjudicates' },
      default: 'auto',
    });

    game.settings.register(MODULE_ID, 'securityLogSeen', {
      name: 'Security Log Last Seen',
      hint: 'Client timestamp of the last time this GM opened the Admin Security tab — drives the NEW markers.',
      scope: 'client',
      config: false,
      type: Number,
      default: 0,
    });

    game.settings.register(MODULE_ID, 'traceLog', {
      name: 'Trace Log',
      hint: 'Durable GM record of every trace event (who tripped what, where, when). Surfaced in the Admin Security tab.',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'traceCountdowns', {
      name: 'Trace Countdowns',
      hint: 'Active "the corp found you" trace countdowns (GM escalation). Fire on expiry via the time provider.',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    /**
     * What happens when a planted program's trigger matches (e.g. the target logs
     * in). The default PROPOSES rather than auto-fires because a plant firing may
     * be the moment the table wants to actually run the NET — but that intent was
     * invisible, so the prompt now says so, and a table that doesn't play it that
     * way can just switch this to Automatic.
     */
    game.settings.register(MODULE_ID, 'residentFireMode', {
      name: 'Planted Programs — When They Fire',
      hint: 'A planted program (an uploaded forgery) waits for its trigger, e.g. the target\'s next login. '
        + 'Automatically (default): it fires the moment it triggers and the GM is just told. '
        + 'Ask me: the GM gets a prompt to fire, defuse, or leave it — the pause where a table can run the netrun before deciding. '
        + 'Only when I say so: it never prompts; it waits for you to fire it from Admin → Security.',
      scope: 'world',
      config: true,
      type: String,
      default: 'auto',
      choices: {
        auto: 'Automatically, no prompt',
        propose: 'Ask me (pause for the netrun)',
        manual: 'Only when I say so (Security tab)',
      },
    });

    game.settings.register(MODULE_ID, 'securityAlertLevel', {
      name: 'Security Alert Level',
      hint: 'How loudly the GM is pinged when a trace fires: every / serious / off. The log always records regardless.',
      scope: 'client',
      config: false,
      type: String,
      default: 'serious',
    });

    game.settings.register(MODULE_ID, 'traceHeat', {
      name: 'Trace Heat',
      hint: 'Per-(object × actor) heat accrued from traces ({ [objectId]: { [actorId]: { value, ts } } }); decays over game time.',
      scope: 'world',
      config: false,
      type: Object,
      default: {},
    });

    game.settings.register(MODULE_ID, 'recycleBin', {
      name: 'Recycle Bin',
      hint: 'GM-only quarantine of entries removed by the malware `wipe` effect ([{ id, ts, hostName, journalId, pageData, wipedBy }]). Restorable / permanently emptiable from the Admin Security tab — a wipe is never a hard delete until the GM empties it.',
      scope: 'world',
      config: false,
      type: Array,
      default: [],
    });

    game.settings.register(MODULE_ID, 'namespaceMigrationDone', {
      name: 'Namespace Migration Done',
      hint: 'Internal. True once this world has been checked for (and, if found, migrated from) data stored under the module\'s original id. See scripts/core/NamespaceMigration.js.',
      scope: 'world',
      config: false,
      type: Boolean,
      default: false,
    });

    game.settings.register(MODULE_ID, 'dataSchemaVersion', {
      name: 'Data Schema Version',
      hint: 'Internal. The highest MigrationRunner migration this world has applied — breaking flag-shape changes register a migration keyed above it. 0 = pre-versioning world.',
      scope: 'world',
      config: false,
      type: Number,
      default: 0,
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
   * The Agent's exfil-folder label (the tab AND the provenance chip read this,
   * so they can't drift apart). Blank/unset falls back to "Exfil".
   * @returns {string}
   */
  getExfilFolderName() {
    const v = String(this.get('exfilFolderName') ?? '').trim();
    return v || 'Exfil';
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
