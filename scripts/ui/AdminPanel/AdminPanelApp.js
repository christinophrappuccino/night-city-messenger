/**
 * AdminPanelApp — Sprint 4: 6-Tab GM Dashboard
 * @file scripts/ui/AdminPanel/AdminPanelApp.js
 * @module cyberpunkred-messenger
 * @description GM command center with 6 tabs: Overview, Messages, Contacts,
 *              Networks, Data Shards, Tools. Condensed header with inline stat
 *              counters, HUD strip, and context-aware footer.
 *              Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, EVENTS, TEMPLATES } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

export class AdminPanelApp extends BaseApplication {

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  /** @type {string} Active tab — one of: overview, messages, contacts, networks, shards, tools */
  _activeTab = 'overview';

  /** @type {boolean} GM compact mode toggle */
  _compactMode = false;

  /** @type {Object<string, number>} Scroll positions per tab for preservation */
  _scrollPositions = {};

  // ── Contacts tab state ──
  /** @type {string} Contact search query */
  _contactSearch = '';
  /** @type {string} Contact sort: 'name' | 'trust' | 'role' | 'recent' | 'org' */
  _contactSort = 'name';
  /** @type {string} Contact filter: 'all' | 'linked' | 'burned' | 'ice' | role names */
  _contactFilter = 'all';
  /** @type {string|null} Expanded contact ID (accordion — one at a time) */
  _expandedContactId = null;
  /** @type {Set<string>} Selected contact IDs for batch operations */
  _selectedContacts = new Set();
  /** @type {Set<string>} Collapsed group keys */
  _collapsedContactGroups = new Set();
  /** @type {boolean} Overflow menu open state */
  _contactOverflowOpen = false;

  // ── Networks tab state (Sprint 6) ──
  /** @type {'cards'|'logs'} Networks tab sub-view */
  _networkSubView = 'cards';
  /** @type {Set<string>} Network IDs with expanded card logs */
  _expandedLogs = new Set();
  /** @type {string} Log type filter for full log panel */
  _logTypeFilter = 'all';
  /** @type {string} Log network filter for full log panel ('' = all) */
  _logNetworkFilter = '';
  /** @type {boolean} Whether the add-log form is visible */
  _showAddLogForm = false;

  /** @type {string} Network search query */
  _networkSearch = '';
  _netAuthFilter = 'all';
  _netStatusFilter = 'all';
  _netGroupFilter = 'all';

  /** @type {Set<string>} Collapsed network group keys */
  _collapsedNetGroups = new Set();

  // ── Shards tab state (Sprint 4.6) ──
  /** @type {Array<object>} In-memory shard activity log for session events */
  _shardActivityLog = [];
  /** @type {boolean} Bulk select mode active */
  _shardSelectMode = false;
  /** @type {Set<string>} Selected shard item IDs */
  _selectedShardIds = new Set();
  /** @type {string|null} Expanded shard row item ID for inline preview */
  _expandedShardId = null;
  /** @type {Set<string>} Collapsed owner group keys */
  _collapsedShardGroups = new Set();
  /** @type {string} Shard search query */
  _shardSearch = '';
  /** @type {string} Shard sort: 'name' | 'status' | 'accessed' */
  _shardSort = 'name';
  /** @type {string} Shard group mode: 'owner' | 'preset' | 'status' | 'none' */
  _shardGroupMode = 'owner';
  /** @type {string} ICE filter: 'all' | 'ice' | 'black_ice' | 'red_ice' | 'none' */
  _shardIceFilter = 'all';
  /** @type {string} Status filter: 'all' | 'locked' | 'breached' | 'open' | 'destroyed' */
  _shardStatusFilter = 'all';
  /** @type {string} Owner filter: 'all' | 'world' | 'actors' */
  _shardOwnerFilter = 'all';

  // ═══════════════════════════════════════════════════════════
  //  Service Accessors
  // ═══════════════════════════════════════════════════════════

  get messageService() { return game.nightcity?.messageService; }
  get schedulingService() { return game.nightcity?.schedulingService; }
  get networkService() { return game.nightcity?.networkService; }
  get masterContactService() { return game.nightcity?.masterContactService; }
  get messageRepository() { return game.nightcity?.messageRepository; }
  get dataShardService() { return game.nightcity?.dataShardService; }
  get contactRepository() { return game.nightcity?.contactRepository; }
  get accessLogService() { return game.nightcity?.accessLogService; }

  // ═══════════════════════════════════════════════════════════
  //  ApplicationV2 Configuration
  // ═══════════════════════════════════════════════════════════

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-admin-panel',
    classes: ['ncm-app', 'ncm-admin-panel'],
    window: {
      title: 'NCM.Admin.Panel',
      icon: 'fas fa-terminal',
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 820,
      height: 600,
    },
    actions: {
      // Tab navigation
      switchTab: AdminPanelApp._onSwitchTab,

      // Overview actions
      openInbox: AdminPanelApp._onOpenInbox,
      openAllInboxes: AdminPanelApp._onOpenAllInboxes,

      // Messages actions
      quickSend: AdminPanelApp._onQuickSend,
      openComposer: AdminPanelApp._onOpenComposer,
      cancelScheduled: AdminPanelApp._onCancelScheduled,
      editScheduled: AdminPanelApp._onEditScheduled,

      // Contacts actions
      openGMContacts: AdminPanelApp._onOpenGMContacts,
      pushContact: AdminPanelApp._onPushContact,
      viewPlayerContacts: AdminPanelApp._onViewPlayerContacts,
      gmVerifyContact:    AdminPanelApp._onGMVerifyContact,
      gmUnverifyContact:  AdminPanelApp._onGMUnverifyContact,
      sendAsContact:      AdminPanelApp._onSendAsContact,
      openContactInbox:   AdminPanelApp._onOpenContactInbox,
      composeToContact:   AdminPanelApp._onComposeToContact,
      exportContacts:     AdminPanelApp._onExportContacts,
      importActorsAsContacts: AdminPanelApp._onImportContactsJSON,
      editContactInEditor: AdminPanelApp._onEditContactInEditor,
      createNewContact:    AdminPanelApp._onCreateNewContact,
      pushAllContacts:     AdminPanelApp._onPushAllContacts,
      contactFilter:       AdminPanelApp._onContactFilter,
      contactClearSearch:  AdminPanelApp._onContactClearSearch,
      setContactTrust:     AdminPanelApp._onSetContactTrust,
      toggleContactExpand: AdminPanelApp._onToggleContactExpand,
      toggleContactSelect: AdminPanelApp._onToggleContactSelect,
      clearContactSelection: AdminPanelApp._onClearContactSelection,
      toggleContactGroup:  AdminPanelApp._onToggleContactGroup,
      toggleContactOverflow: AdminPanelApp._onToggleContactOverflow,
      burnContact:         AdminPanelApp._onBurnContact,
      shareContactToPlayer: AdminPanelApp._onShareContactToPlayer,
      syncFromActors:      AdminPanelApp._onSyncFromActors,
      batchShareContacts:  AdminPanelApp._onBatchShareContacts,
      batchTagContacts:    AdminPanelApp._onBatchTagContacts,
      batchBurnContacts:   AdminPanelApp._onBatchBurnContacts,

      // Networks actions
      toggleNetwork: AdminPanelApp._onToggleNetwork,
      openNetworkManager: AdminPanelApp._onOpenNetworkManager,
      editNetworkInManager: AdminPanelApp._onEditNetworkInManager,
      toggleSceneDeadZone: AdminPanelApp._onToggleSceneDeadZone,
      switchNetworkSubView: AdminPanelApp._onSwitchNetworkSubView,
      toggleCardLog: AdminPanelApp._onToggleCardLog,
      deleteLogEntry: AdminPanelApp._onDeleteLogEntry,
      editLogEntry: AdminPanelApp._onEditLogEntry,
      filterLogType: AdminPanelApp._onFilterLogType,
      addManualLogEntry: AdminPanelApp._onAddManualLogEntry,
      toggleAddLogForm: AdminPanelApp._onToggleAddLogForm,
      exportNetworkLogs: AdminPanelApp._onExportNetworkLogs,
      exportFormattedNetworkLogs: AdminPanelApp._onExportFormattedNetworkLogs,
      importNetworkLogs: AdminPanelApp._onImportNetworkLogs,
      clearNetworkLogs: AdminPanelApp._onClearNetworkLogs,
      resetNetworkAuth: AdminPanelApp._onResetNetworkAuth,
      sendBroadcast: AdminPanelApp._onSendBroadcast,
      scrollMixerLeft: AdminPanelApp._onScrollMixerLeft,
      scrollMixerRight: AdminPanelApp._onScrollMixerRight,
      cycleNetAuthFilter: AdminPanelApp._onCycleNetAuthFilter,
      cycleNetStatusFilter: AdminPanelApp._onCycleNetStatusFilter,
      cycleNetGroupFilter: AdminPanelApp._onCycleNetGroupFilter,
      openNetworkManagerLogs: AdminPanelApp._onOpenNetworkManagerLogs,
      toggleNetworkGroup: AdminPanelApp._onToggleNetworkGroup,

      // Data Shards actions
      openShardItem: AdminPanelApp._onOpenShardItem,
      forceDecryptShard: AdminPanelApp._onForceDecrypt,
      relockShard: AdminPanelApp._onRelockShard,
      convertItemToShard: AdminPanelApp._onConvertItem,
      quickCreateShard: AdminPanelApp._onQuickCreateShard,
      bulkRelockAll: AdminPanelApp._onBulkRelockAll,
      purgeDestroyed: AdminPanelApp._onPurgeDestroyed,
      configureShardItem: AdminPanelApp._onConfigureShardItem,
      relockShardItem: AdminPanelApp._onRelockShardItem,
      // v4 shard actions
      toggleShardGroup: AdminPanelApp._onToggleShardGroup,
      toggleShardSelect: AdminPanelApp._onToggleShardSelect,
      toggleShardSelectMode: AdminPanelApp._onToggleShardSelectMode,
      deselectAllShards: AdminPanelApp._onDeselectAllShards,
      expandShard: AdminPanelApp._onExpandShard,
      bulkRelockSelected: AdminPanelApp._onBulkRelockSelected,
      bulkExportSelected: AdminPanelApp._onBulkExportSelected,
      unconvertShard: AdminPanelApp._onUnconvertShard,
      cycleShardSort: AdminPanelApp._onCycleShardSort,
      cycleShardIceFilter: AdminPanelApp._onCycleShardIceFilter,
      cycleShardStatusFilter: AdminPanelApp._onCycleShardStatusFilter,
      cycleShardPresetFilter: AdminPanelApp._onCycleShardPresetFilter,
      cycleShardOwnerFilter: AdminPanelApp._onCycleShardOwnerFilter,
      cycleShardGroupMode: AdminPanelApp._onCycleShardGroupMode,
      forceDecryptShardItem: AdminPanelApp._onForceDecryptShardItem,
      toggleShardLayer: AdminPanelApp._onToggleShardLayer,

      // Tools actions
      openThemeCustomizer: AdminPanelApp._onOpenThemeCustomizer,
      forceRefreshAll: AdminPanelApp._onForceRefreshAll,
      refreshStats: AdminPanelApp._onRefreshStats,
      exportLogs: AdminPanelApp._onExportLogs,
      healthCheck: AdminPanelApp._onHealthCheck,
      openTimeSettings: AdminPanelApp._onOpenTimeSettings,
      openSoundSettings: AdminPanelApp._onOpenSoundSettings,

      // Danger zone
      purgeMessages: AdminPanelApp._onPurgeMessages,
      resetModule: AdminPanelApp._onResetModule,
      rebuildIndex: AdminPanelApp._onRebuildIndex,

      // Legacy
      toggleCompactMode: AdminPanelApp._onToggleCompactMode,
      hardDeleteMessage: AdminPanelApp._onHardDeleteMessage,
      openContacts: AdminPanelApp._onOpenGMContacts,
      openNetworks: AdminPanelApp._onOpenNetworkManager,
    },
  }, { inplace: false });

  static PARTS = {
    main: {
      template: TEMPLATES.ADMIN_PANEL,
    },
  };

  // ═══════════════════════════════════════════════════════════
  //  Data Preparation
  // ═══════════════════════════════════════════════════════════

  /**
   * Prepare full template context for the 6-tab dashboard.
   * @param {object} options
   * @returns {Promise<object>}
   */
  async _prepareContext(options) {
    if (!isGM()) return { isGM: false };

    // ─── Core Stats (reused across tabs) ───
    const stats = await this._gatherStats();

    // ─── Scheduled Tab Data ───
    const scheduled = this.schedulingService?.getPending() ?? [];
    const scheduledEntries = scheduled.map(entry => this._formatScheduledEntry(entry));

    // ─── Connections (Overview) ───
    const connections = this._gatherConnections();

    // ─── NPC Actors (Messages tab quick-send) ───
    const npcActors = this._gatherNPCActors();

    // ─── Player Actors ───
    const playerActors = this._gatherPlayerActors();

    // ─── Contacts (Contacts tab) ───
    const contactSummary = this._gatherContactSummary();

    // ─── Networks (Networks tab) ───
    const networks = this._gatherNetworkData();
    const networkSummary = {
      active: networks.filter(n => n.enabled).length,
    };

    // Add signalTier for mixer display
    for (const net of networks) {
      if (net.signal >= 70) net.signalTier = 'good';
      else if (net.signal >= 40) net.signalTier = 'mid';
      else if (net.signal > 0) net.signalTier = 'low';
      else net.signalTier = 'dead';
    }

    // ─── Connected Players (Networks tab — War Room) ───
    const connectedPlayers = this._gatherConnectedPlayers(networks);

    // ─── Scene Quick Strip (Networks tab — Sprint 6) ───
    const sceneStrip = this._gatherSceneStrip();

    // ─── Network Stats (Networks tab — Sprint 6) ───
    const allNetworks = this.networkService?.getAllNetworks?.() ?? [];
    const netStats = {
      total: allNetworks.length,
      active: networks.filter(n => n.enabled).length,
      deadZones: sceneStrip.filter(s => s.deadZone).length,
      secured: allNetworks.filter(n => n.security?.requiresAuth).length,
      connected: game.users?.filter(u => u.active && !u.isGM)?.length ?? 0,
    };

    // ─── Full Log Panel (Networks tab — Sprint 6) ───
    const fullLogEntries = this._gatherFullLogEntries();
    const logTypeFilters = [
      { value: 'all', label: 'All', active: this._logTypeFilter === 'all' },
      { value: 'connect', label: 'Connect', active: this._logTypeFilter === 'connect' },
      { value: 'auth', label: 'Auth', active: this._logTypeFilter === 'auth' },
      { value: 'hack', label: 'Hack', active: this._logTypeFilter === 'hack' },
      { value: 'lockout', label: 'Lockout', active: this._logTypeFilter === 'lockout' },
      { value: 'manual', label: 'Manual', active: this._logTypeFilter === 'manual' },
    ];

    // ─── Data Shards (Shards tab) ───
    const shards = this._gatherShardData();
    const shardGroups = this._buildShardGroups(shards);
    const shardSummary = {
      total: shards.length,
      locked: shards.filter(s => s.status === 'locked' || s.status === 'blackice').length,
      breached: shards.filter(s => s.status === 'breached').length,
      destroyed: shards.filter(s => s.status === 'destroyed').length,
      open: shards.filter(s => s.status === 'open').length,
      totalEddies: shards.reduce((sum, s) => sum + (s.totalEddies || 0), 0),
      claimedEddies: shards.reduce((sum, s) => sum + (s.claimedEddies || 0), 0),
      unclaimedEddies: shards.reduce((sum, s) => sum + (s.unclaimedEddies || 0), 0),
      totalEntries: shards.reduce((sum, s) => sum + (s.entryCount || 0), 0),
    };

    // Quick-create preset buttons
    const shardPresetButtons = (game.nightcity?.dataShardService?.getAllPresets() ?? [])
      .filter(p => p.key !== 'blank');

    // ─── Shard Activity Log (Shards tab) ───
    const shardActivityLog = this._shardActivityLog.slice(0, 10);

    // ─── Push Log (Contacts tab) ───
    const pushLog = this._gatherPushLog();

    // ─── HUD strip counts ───
    const hudCounts = {
      actors: stats.actorStats.length,
      contacts: contactSummary.total,
      networks: networks.length,
      shards: shards.length,
    };

    // ─── Online count ───
    const onlineCount = game.users?.filter(u => u.active)?.length ?? 0;

    // ─── Current network ───
    const currentNetworkId = this.networkService?.currentNetworkId ?? 'CITINET';
    const currentNetwork = this.networkService?.getNetwork?.(currentNetworkId)?.name ?? currentNetworkId;

    return {
      isGM: true,
      activeTab: this._activeTab,
      compactMode: this._compactMode,

      // Header
      stats,
      scheduledCount: scheduled.length,
      onlineCount,
      currentNetwork,
      hudCounts,

      // Overview tab
      connections,

      // Messages tab
      npcActors,
      playerActors,
      scheduledEntries,

      // Contacts tab
      contactSummary,
      pushLog,

      // Networks tab
      networks,  // Full flat list (for dropdowns + mixer)
      connectedPlayers,
      networkGroups: this._buildNetworkGroups(this._filterNetworks(networks)),
      networkSummary,
      sceneStrip,
      netStats,
      networkSubView: this._networkSubView,
      networkSearchQuery: this._networkSearch,
      netAuthFilter: this._netAuthFilter,
      netStatusFilter: this._netStatusFilter,
      netGroupFilter: this._netGroupFilter,
      fullLogEntries,
      logTypeFilters,
      logNetworkFilter: this._logNetworkFilter,
      showAddLogForm: this._showAddLogForm,
      logEntryCount: this.accessLogService?.entryCount ?? 0,

      // Shards tab
      shards,
      shardGroups,
      shardSummary,
      shardPresetButtons,
      shardActivityLog,
      shardSelectMode: this._shardSelectMode,
      shardSelectedCount: this._selectedShardIds.size,
      shardSearch: this._shardSearch,
      shardSort: this._shardSort,
      shardGroupMode: this._shardGroupMode,
      shardIceFilter: this._shardIceFilter,
      shardStatusFilter: this._shardStatusFilter,
      shardOwnerFilter: this._shardOwnerFilter,

      // Module info
      MODULE_ID,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Data Gathering Methods
  // ═══════════════════════════════════════════════════════════

  /**
   * Gather message statistics across all inboxes.
   * @returns {Promise<object>}
   * @private
   */
  async _gatherStats() {
    const stats = {
      totalMessages: 0,
      unreadMessages: 0,
      actorStats: [],
      messagesByPriority: { normal: 0, urgent: 0, critical: 0 },
      scheduledPending: this.schedulingService?.getPending()?.length ?? 0,
    };

    try {
      for (const actor of game.actors) {
        const messages = await this.messageService?.getMessages(actor.id) ?? [];
        if (messages.length === 0) continue;

        const unread = messages.filter(m =>
          !m.status?.read && !m.status?.sent && !m.status?.deleted
        ).length;

        stats.totalMessages += messages.length;
        stats.unreadMessages += unread;

        for (const msg of messages) {
          const p = msg.priority || 'normal';
          if (stats.messagesByPriority[p] !== undefined) {
            stats.messagesByPriority[p]++;
          }
        }

        // Find owner user name
        const ownerEntry = Object.entries(actor.ownership || {})
          .find(([uid, level]) => uid !== 'default' && level >= 3);
        const ownerUser = ownerEntry ? game.users.get(ownerEntry[0]) : null;

        // Avatar color — use owner user color or fallback
        const avatarColor = ownerUser?.color ?? (actor.hasPlayerOwner ? '#19f3f7' : '#f7c948');
        const initial = actor.name?.charAt(0)?.toUpperCase() ?? '?';

        stats.actorStats.push({
          actorId: actor.id,
          actorName: actor.name,
          actorImg: actor.img && !actor.img.includes('mystery-man') ? actor.img : null,
          hasPlayerOwner: actor.hasPlayerOwner,
          totalMessages: messages.length,
          unreadMessages: unread,
          ownerName: ownerUser?.name ?? (actor.hasPlayerOwner ? '' : 'NPC'),
          avatarColor,
          avatarBorderColor: `${avatarColor}66`,
          initial,
          lastActive: unread === 0 ? this._getRelativeTime(messages[0]?.timestamp) : '',
        });
      }

      stats.actorStats.sort((a, b) => b.totalMessages - a.totalMessages);
    } catch (error) {
      console.error(`${MODULE_ID} | AdminPanelApp._gatherStats:`, error);
    }

    return stats;
  }

  /**
   * Gather active user connections.
   * @returns {Array<object>}
   * @private
   */
  _gatherConnections() {
    const connections = [];
    const sessionStart = game.time?.worldTime ?? Date.now() / 1000;

    for (const user of game.users) {
      if (!user.active) continue;

      const actors = user.isGM
        ? game.actors.filter(a => !a.hasPlayerOwner).slice(0, 3).map(a => a.name)
        : game.actors.filter(a => {
            const ownership = a.ownership || {};
            return ownership[user.id] >= 3;
          }).map(a => a.name);

      const npcCount = user.isGM ? game.actors.filter(a => !a.hasPlayerOwner).length : 0;
      let actorNames = actors.join(', ');
      if (user.isGM && npcCount > 3) {
        actorNames += ` (+${npcCount - 3} NPC)`;
      }

      connections.push({
        userId: user.id,
        userName: user.name,
        isGM: user.isGM,
        color: user.color,
        actorNames: actorNames || '—',
        sessionTime: this._formatSessionTime(user),
      });
    }

    return connections;
  }

  /**
   * Gather NPC actors for the quick-send grid.
   * @returns {Array<object>}
   * @private
   */
  _gatherNPCActors() {
    return game.actors
      .filter(a => !a.hasPlayerOwner)
      .filter(a => a.getFlag(MODULE_ID, 'email'))
      .map(a => ({
        id: a.id,
        name: a.name,
        img: a.img,
        email: a.getFlag(MODULE_ID, 'email'),
        initial: a.name?.charAt(0)?.toUpperCase() ?? '?',
        color: '#F65261',
        lastMessage: null, // TODO: Fetch last sent message preview
      }))
      .slice(0, 10); // Cap at 10 for grid space
  }

  /**
   * Gather player-owned actors.
   * @returns {Array<object>}
   * @private
   */
  _gatherPlayerActors() {
    return game.actors
      .filter(a => a.hasPlayerOwner)
      .map(a => ({
        id: a.id,
        name: a.name,
        img: a.img,
      }));
  }

  /**
   * Gather contact summary for the Contacts tab.
   * @returns {object}
   * @private
   */
  _gatherContactSummary() {
    const contacts = this.masterContactService?.getAll() ?? [];

    // ── Role config ──
    const roleChipMap = {
      fixer:     { label: 'Fixer',   type: 'role-fixer',     icon: 'crosshairs' },
      netrunner: { label: 'Runner',  type: 'role-netrunner',  icon: 'terminal' },
      runner:    { label: 'Runner',  type: 'role-netrunner',  icon: 'terminal' },
      corp:      { label: 'Corp',    type: 'role-corp',       icon: 'briefcase' },
      solo:      { label: 'Solo',    type: 'role-solo',       icon: 'crosshairs' },
      tech:      { label: 'Tech',    type: 'role-tech',       icon: 'wrench' },
      medtech:   { label: 'Medtech', type: 'role-tech',       icon: 'wrench' },
      media:     { label: 'Media',   type: 'role-media',      icon: 'podcast' },
      nomad:     { label: 'Nomad',   type: 'role-solo',       icon: 'truck-monster' },
      exec:      { label: 'Exec',    type: 'role-corp',       icon: 'briefcase' },
      lawman:    { label: 'Lawman',  type: 'role-lawman',     icon: 'shield-halved' },
      rockerboy: { label: 'Rocker',  type: 'role-fixer',      icon: 'guitar' },
    };

    const trustLabels = { 5: 'Trusted', 4: 'Trusted', 3: 'Neutral', 2: 'Wary', 1: 'Hostile', 0: 'Unknown' };

    // ── Gather player-owned actors for "Known by" + Player Characters group ──
    const playerActors = [];
    for (const user of game.users) {
      if (user.isGM || !user.character) continue;
      playerActors.push({
        actorId: user.character.id,
        actorName: user.character.name,
        playerName: user.name,
        initial: (user.character.name || '?').charAt(0).toUpperCase(),
      });
    }

    // ── Build "Known by" for a contact: check which player actors have it ──
    const contactRepo = game.nightcity?.contactRepository;
    const _buildKnownBy = (masterContactId, contactEmail) => {
      const pips = [];
      const expanded = [];
      for (const pa of playerActors) {
        let has = false;
        try {
          const playerContacts = contactRepo?.getAll(pa.actorId) ?? [];
          has = playerContacts.some(pc =>
            pc.masterContactId === masterContactId ||
            (contactEmail && pc.email?.toLowerCase() === contactEmail.toLowerCase())
          );
        } catch { /* actor may not have contacts */ }
        pips.push({
          initial: pa.initial,
          has,
          tooltip: has
            ? `${pa.actorName} (${pa.playerName}) has this contact`
            : `${pa.actorName} (${pa.playerName}) does not have this contact`,
        });
        expanded.push({
          characterName: pa.actorName,
          playerName: pa.playerName,
          has,
        });
      }
      return { pips, expanded };
    };

    // ── Enrich all master contacts ──
    const enriched = contacts.map(c => {
      const trust = c.trust ?? 0;
      let trustLevel = 'none';
      if (trust >= 4) trustLevel = 'high';
      else if (trust >= 2) trustLevel = 'med';
      else if (trust >= 1) trustLevel = 'low';

      const roleLower = (c.role || '').toLowerCase();
      const roleInfo = roleChipMap[roleLower];

      const avatarColor = c.burned ? '#ff3355' : c.encrypted ? '#f7c948' : '#9a9ab5';
      const networkSlug = (c.network || 'citinet').toLowerCase().replace(/[^a-z]/g, '');

      // Actor resolution
      let actorName = null;
      let playerOwnerName = null;
      let isPlayerOwned = false;
      if (c.actorId) {
        const actor = game.actors?.get(c.actorId);
        actorName = actor?.name || null;
        if (actor?.hasPlayerOwner) {
          isPlayerOwned = true;
          const ownerEntry = Object.entries(actor.ownership || {}).find(
            ([uid, level]) => uid !== 'default' && level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
          );
          if (ownerEntry) {
            playerOwnerName = game.users.get(ownerEntry[0])?.name || null;
          }
        }
      }

      // Build color-coded chips
      const chips = [];
      if (roleInfo) chips.push({ type: roleInfo.type, label: roleInfo.label, icon: roleInfo.icon });
      if (c.organization) chips.push({ type: 'org', label: c.organization, icon: 'building' });
      if (c.location) chips.push({ type: 'loc', label: c.location, icon: 'location-dot' });
      if (c.alias) chips.push({ type: 'alias', label: c.alias, icon: null });
      if (c.tags) c.tags.forEach(t => chips.push({ type: 'tag', label: t, icon: null }));

      // Known-by
      const knownBy = _buildKnownBy(c.id, c.email);

      // Activity label
      let activeLabel = 'Never contacted';
      let activeRecent = false;
      if (c.updatedAt) {
        const diff = Date.now() - new Date(c.updatedAt).getTime();
        const hours = diff / (1000 * 60 * 60);
        if (hours < 24) { activeLabel = 'Active today'; activeRecent = true; }
        else if (hours < 168) activeLabel = 'This week';
        else activeLabel = 'Inactive';
      }

      // Notes preview (first ~60 chars)
      const notesPreview = c.notes ? (c.notes.length > 60 ? c.notes.slice(0, 60) + '...' : c.notes) : '';

      return {
        id: c.id,
        name: c.name,
        email: c.email || '—',
        alias: c.alias || '',
        phone: c.phone || '',
        notes: c.notes || '',
        notesPreview,
        role: c.role,
        roleLower,
        roleBadge: roleInfo?.label ?? null,
        trust,
        trustLevel,
        trustLabel: trustLabels[trust] ?? 'Unknown',
        trustSegments: [
          { value: 1, active: trust >= 1 },
          { value: 2, active: trust >= 2 },
          { value: 3, active: trust >= 3 },
          { value: 4, active: trust >= 4 },
          { value: 5, active: trust >= 5 },
        ],
        burned: c.burned ?? false,
        encrypted: c.encrypted ?? false,
        encryptionDV: c.encryptionDV,
        encryptionSkill: c.encryptionSkill || 'Interface',
        actorId: c.actorId || null,
        actorName,
        playerOwnerName,
        isPlayerOwned,
        portrait: c.portrait || null,
        hasPortrait: !!c.portrait,
        initial: (c.name || '?').charAt(0).toUpperCase(),
        avatarColor,
        avatarBorderColor: `${avatarColor}66`,
        networkSlug,
        networkName: (c.network || 'Citinet').charAt(0).toUpperCase() + (c.network || 'citinet').slice(1),
        contactType: isPlayerOwned ? 'Player' : (c.type || 'NPC').charAt(0).toUpperCase() + (c.type || 'npc').slice(1),
        organization: c.organization || '',
        location: c.location || '',
        tags: c.tags || [],
        chips,
        knownByPips: knownBy.pips,
        knownByExpanded: knownBy.expanded,
        activeLabel,
        activeRecent,
        updatedAt: c.updatedAt || c.createdAt || '',
        noInbox: false,
        isExpanded: this._expandedContactId === c.id,
        isSelected: this._selectedContacts.has(c.id),
        // Recent messages (populated below for expanded contact)
        recentMessages: [],
      };
    });

    // ── Inject player characters that aren't already master contacts ──
    const masterActorIds = new Set(enriched.map(c => c.actorId).filter(Boolean));
    for (const pa of playerActors) {
      if (masterActorIds.has(pa.actorId)) continue;
      const actor = game.actors?.get(pa.actorId);
      if (!actor) continue;
      const email = actor.getFlag?.('cyberpunkred-messenger', 'email') || '';
      enriched.push({
        id: `pc-${pa.actorId}`,
        name: pa.actorName,
        email: email || '—',
        alias: '', phone: '', notes: '', notesPreview: '',
        role: '', roleLower: '', roleBadge: null,
        trust: 5, trustLevel: 'high', trustLabel: 'Trusted',
        trustSegments: [
          { value: 1, active: true }, { value: 2, active: true },
          { value: 3, active: true }, { value: 4, active: true },
          { value: 5, active: true },
        ],
        burned: false, encrypted: false, encryptionDV: null, encryptionSkill: '',
        actorId: pa.actorId, actorName: pa.actorName,
        playerOwnerName: pa.playerName, isPlayerOwned: true,
        portrait: actor.img || null, hasPortrait: !!actor.img && actor.img !== 'icons/svg/mystery-man.svg',
        initial: pa.initial,
        avatarColor: '#19f3f7', avatarBorderColor: 'rgba(25,243,247,0.4)',
        networkSlug: 'citinet', networkName: 'Citinet',
        contactType: 'Player',
        organization: '', location: '', tags: [], chips: [],
        knownByPips: [], knownByExpanded: [],
        activeLabel: email ? 'Active today' : 'Never contacted',
        activeRecent: !!email,
        updatedAt: '', noInbox: !email,
        isExpanded: this._expandedContactId === `pc-${pa.actorId}`,
        isSelected: this._selectedContacts.has(`pc-${pa.actorId}`),
        recentMessages: [],
      });
    }

    // ── Populate recent messages for expanded contact ──
    const expandedContact = enriched.find(c => c.isExpanded);
    if (expandedContact && !expandedContact.noInbox) {
      try {
        const inboxJournal = game.nightcity?.messageRepository?.getInboxJournal?.(
          expandedContact.actorId || expandedContact.id
        );
        if (inboxJournal) {
          const pages = [...(inboxJournal.pages || [])].sort(
            (a, b) => (b.getFlag?.('cyberpunkred-messenger', 'timestamp') || '')
              .localeCompare(a.getFlag?.('cyberpunkred-messenger', 'timestamp') || '')
          );
          expandedContact.recentMessages = pages.slice(0, 3).map(page => {
            const flags = page.flags?.['cyberpunkred-messenger'] || {};
            const fromName = flags.senderName || flags.from || '?';
            const toName = flags.recipientName || flags.to || '?';
            const isSent = fromName.toLowerCase().includes(expandedContact.name.toLowerCase());
            return {
              from: fromName, to: toName, sent: isSent,
              preview: (flags.subject || page.name || '(no subject)').slice(0, 50),
              time: flags.timestamp ? this._relativeTime(flags.timestamp) : '',
            };
          });
        }
      } catch { /* inbox may not exist */ }
    }

    // ── Totals ──
    const total = enriched.length;
    const burned = enriched.filter(c => c.burned).length;
    const encrypted = enriched.filter(c => c.encrypted).length;
    const linked = enriched.filter(c => c.actorId).length;
    const unlinked = total - linked;
    const playerCount = enriched.filter(c => c.isPlayerOwned).length;

    // ── Role counts for filter pills ──
    const roleCountMap = {};
    enriched.forEach(c => {
      if (c.roleBadge) roleCountMap[c.roleBadge] = (roleCountMap[c.roleBadge] || 0) + 1;
    });
    const roleCounts = Object.entries(roleCountMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));

    // ── Apply search ──
    let filtered = enriched;
    const q = this._contactSearch?.toLowerCase().trim();
    if (q) {
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.organization && c.organization.toLowerCase().includes(q)) ||
        (c.location && c.location.toLowerCase().includes(q)) ||
        (c.alias && c.alias.toLowerCase().includes(q)) ||
        (c.notes && c.notes.toLowerCase().includes(q)) ||
        (c.actorName && c.actorName.toLowerCase().includes(q)) ||
        (c.playerOwnerName && c.playerOwnerName.toLowerCase().includes(q)) ||
        c.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // ── Apply filter ──
    const f = this._contactFilter;
    if (f && f !== 'all') {
      switch (f) {
        case 'linked':   filtered = filtered.filter(c => c.actorId); break;
        case 'unlinked': filtered = filtered.filter(c => !c.actorId); break;
        case 'burned':   filtered = filtered.filter(c => c.burned); break;
        case 'ice':      filtered = filtered.filter(c => c.encrypted); break;
        case 'player':   filtered = filtered.filter(c => c.isPlayerOwned); break;
        default:
          filtered = filtered.filter(c =>
            c.roleLower === f.toLowerCase() ||
            (c.roleBadge && c.roleBadge.toLowerCase() === f.toLowerCase())
          );
          break;
      }
    }

    // ── Apply sort ──
    switch (this._contactSort) {
      case 'name':
        filtered.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'trust':
        filtered.sort((a, b) => b.trust - a.trust || a.name.localeCompare(b.name)); break;
      case 'role':
        filtered.sort((a, b) => (a.roleLower || 'zzz').localeCompare(b.roleLower || 'zzz') || a.name.localeCompare(b.name)); break;
      case 'recent':
        filtered.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')); break;
      case 'org':
        filtered.sort((a, b) => (a.organization || 'zzz').localeCompare(b.organization || 'zzz') || a.name.localeCompare(b.name)); break;
    }

    // ── Build groups ──
    const groupOrder = ['Player Characters', 'Fixers', 'Corp Contacts', 'Runners', 'Street Contacts'];
    const groupMap = {};
    for (const c of filtered) {
      let groupName = 'Street Contacts';
      if (c.isPlayerOwned) groupName = 'Player Characters';
      else if (c.roleBadge === 'Fixer') groupName = 'Fixers';
      else if (c.roleBadge === 'Corp' || c.roleBadge === 'Exec') groupName = 'Corp Contacts';
      else if (c.roleBadge === 'Runner') groupName = 'Runners';

      if (!groupMap[groupName]) groupMap[groupName] = [];
      groupMap[groupName].push(c);
    }
    const groups = [];
    for (const name of groupOrder) {
      if (groupMap[name]?.length) {
        const key = name.toLowerCase().replace(/\s+/g, '-');
        groups.push({
          key,
          name,
          contacts: groupMap[name],
          collapsed: this._collapsedContactGroups.has(key),
        });
      }
    }
    // Remaining groups not in groupOrder
    for (const [name, contacts] of Object.entries(groupMap)) {
      if (!groupOrder.includes(name) && contacts.length) {
        const key = name.toLowerCase().replace(/\s+/g, '-');
        groups.push({ key, name, contacts, collapsed: this._collapsedContactGroups.has(key) });
      }
    }

    // ── Send As chips (up to 5 most recently updated NPC contacts) ──
    const sendAsChips = enriched
      .filter(c => !c.isPlayerOwned && !c.burned && !c.noInbox)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 5)
      .map(c => ({
        id: c.id,
        name: c.name,
        chipName: c.name.length > 12 ? c.name.split(' ')[0] : c.name,
        initial: c.initial,
        avatarColor: c.avatarColor,
        avatarBorderColor: c.avatarBorderColor,
        portrait: c.portrait,
        hasPortrait: c.hasPortrait,
      }));

    return {
      total,
      burned,
      encrypted,
      linked,
      unlinked,
      playerCount,
      filteredCount: filtered.length,
      groups,
      roleCounts,
      sendAsChips,
      selectedCount: this._selectedContacts.size,
      overflowOpen: this._contactOverflowOpen,
      contactSearch: this._contactSearch,
      contactSort: this._contactSort,
      contactFilter: this._contactFilter,
    };
  }

  /**
   * Relative time helper for message timestamps.
   * @param {string} isoTimestamp
   * @returns {string}
   */
  _relativeTime(isoTimestamp) {
    try {
      const diff = Date.now() - new Date(isoTimestamp).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins} min ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours} hr ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    } catch { return ''; }
  }

  /**
   * Gather network data for the Networks tab.
   * @returns {Array<object>}
   * @private
   */
  _gatherNetworkData() {
     const networks = [];

     try {
       const allNetworks = this.networkService?.getAllNetworks?.() ?? [];
       const currentSceneId = canvas.scene?.id;
       const sceneNetworks = canvas.scene?.getFlag(MODULE_ID, 'networkAvailability') ?? {};

       // Icon mapping for known network types
       const iconMap = {
         citinet:   { icon: 'wifi',     iconClass: 'citinet',  type: 'Public subnet' },
         darknet:   { icon: 'mask',     iconClass: 'darknet',  type: 'Hidden subnet' },
         corpnet:   { icon: 'building', iconClass: 'corpnet',  type: 'Corporate subnet' },
         govnet:    { icon: 'landmark', iconClass: 'govnet',   type: 'Government subnet' },
         deadzone:  { icon: 'ban',      iconClass: 'deadzone', type: 'No signal region' },
         dead_zone: { icon: 'ban',      iconClass: 'deadzone', type: 'No signal region' },
       };

       for (const net of allNetworks) {
         const netId = (net.id || net.name || '').toLowerCase().replace(/\s+/g, '_');
         const known = iconMap[netId] || {
           icon: net.theme?.icon?.replace('fa-', '') || 'network-wired',
           iconClass: 'default',
           type: net.type || 'Custom subnet',
         };

         // ─── Account for global availability ───
         const isGlobal = net.availability?.global === true;
         const isSceneEnabled = !!sceneNetworks[net.id] || !!sceneNetworks[net.name];
         const isEnabled = isGlobal || isSceneEnabled;

         // ─── Auth type detection using correct property types ───
         let authClass = 'open', authIcon = 'lock-open', authLabel = 'Open access';

         if (net.security?.requiresAuth) {
           // requiresAuth is boolean — check what type of auth
           if (net.security.password) {
             authClass = 'password';
             authIcon = 'key';
             authLabel = 'Password required';
           } else if (net.security.bypassSkills?.length > 0) {
             const skillName = net.security.bypassSkills[0] || 'Interface';
             const dv = net.security.bypassDC || 15;
             authClass = 'skill';
             authIcon = 'dice-d20';
             authLabel = `${skillName} DV ${dv}`;
           } else {
             authClass = 'locked';
             authIcon = 'lock';
             authLabel = 'Auth required';
           }
         } else if (netId === 'deadzone' || netId === 'dead_zone') {
           authClass = 'blocked';
           authIcon = 'xmark';
           authLabel = 'All signals blocked';
         }

         // ─── Signal class for color-coding ───
         const signal = net.signalStrength ?? (isEnabled ? 85 : 0);
         let signalClass = '';
         if (signal === 0) signalClass = 'val--danger';
         else if (signal < 50) signalClass = 'val--warning';
         else signalClass = 'val--good';

         // ─── Tags (Core/Custom/Global/Restricted) ───
         const tags = [];
         if (net.isCore) tags.push({ class: 'core', label: 'Core' });
         else tags.push({ class: 'custom', label: 'Custom' });
         if (isGlobal) tags.push({ class: 'global', label: 'Global' });
         if (net.effects?.restrictedAccess) tags.push({ class: 'restricted', label: 'Restricted' });

         // ─── Connected users (approximate — all active non-GM users) ───
         const connectedUsers = game.users
           ?.filter(u => u.active && !u.isGM)
           ?.map(u => ({ id: u.id, name: u.character?.name ?? u.name })) ?? [];

         // ─── Gather scenes where this network appears ───
         const scenes = [];
         for (const scene of game.scenes) {
           const sNets = scene.getFlag(MODULE_ID, 'networkAvailability') ?? {};
           if (sNets[net.id] || sNets[net.name] || isGlobal) {
             scenes.push({
               id: scene.id,
               name: scene.name,
               isCurrent: scene.id === currentSceneId,
             });
           }
         }

         // ─── Per-network log data (Sprint 6) ───
         const networkIdForLog = net.id || net.name;
         const logExpanded = this._expandedLogs.has(networkIdForLog);
         const logCount = this.accessLogService
           ?.getEntries({ networkId: networkIdForLog, limit: 999 })?.length ?? 0;
         const logEntries = logExpanded
           ? (this.accessLogService?.getEntries({ networkId: networkIdForLog, limit: 10 }) ?? [])
             .map(e => this._formatLogEntry(e))
           : [];

         networks.push({
           id: net.id || net.name,
           name: net.name || net.id,
           type: known.type,
           isCore: !!net.isCore,
           group: net.group ?? '',
           enabled: isEnabled,
           isGlobal,
           signal,
           signalClass,
           noSignal: signal === 0,
           reliability: net.reliability ?? (netId === 'deadzone' ? undefined : 85),
           userCount: net.userCount ?? 0,
           icon: known.icon,
           iconClass: known.iconClass,
           theme: net.theme || {},
           authClass,
           authIcon,
           authLabel,
           tags,
           connectedUsers,
           scenes,
           isCurrent: this.networkService?.currentNetworkId === (net.id || net.name),
           logExpanded,
           logCount,
           logEntries,
         });
       }
     } catch (error) {
       console.error(`${MODULE_ID} | AdminPanelApp._gatherNetworkData:`, error);
     }

     return networks;
   }

  /**
   * Apply search + filter pills to network list before grouping.
   * @param {Array} networks
   * @returns {Array}
   * @private
   */
  _filterNetworks(networks) {
    let filtered = networks;

    // Text search
    if (this._networkSearch) {
      const q = this._networkSearch.toLowerCase();
      filtered = filtered.filter(n => n.name.toLowerCase().includes(q));
    }

    // Auth filter
    if (this._netAuthFilter !== 'all') {
      filtered = filtered.filter(n => n.authClass === this._netAuthFilter);
    }

    // Status filter
    if (this._netStatusFilter !== 'all') {
      if (this._netStatusFilter === 'active') filtered = filtered.filter(n => n.enabled);
      else if (this._netStatusFilter === 'disabled') filtered = filtered.filter(n => !n.enabled);
    }

    // Group filter
    if (this._netGroupFilter !== 'all') {
      if (this._netGroupFilter === 'core') filtered = filtered.filter(n => n.isCore);
      else if (this._netGroupFilter === 'custom') filtered = filtered.filter(n => !n.isCore);
    }

    return filtered;
  }

  /**
   * Build grouped network data for the template.
   * Groups: Core first, then custom groups (by group field), then ungrouped.
   * @param {Array} filteredNetworks - Networks (possibly search-filtered)
   * @returns {Array<object>} Array of { name, key, icon, iconClass, collapsed, networks, count }
   * @private
   */
  _buildNetworkGroups(filteredNetworks) {
    const groups = [];

    // Core networks first
    const coreNets = filteredNetworks.filter(n => n.isCore);
    if (coreNets.length) {
      groups.push({
        name: 'Core Subnets',
        key: '_core',
        icon: 'fa-server',
        iconClass: '',
        collapsed: this._collapsedNetGroups.has('_core'),
        networks: coreNets,
        count: coreNets.length,
      });
    }

    // Custom networks grouped by group field
    const customNets = filteredNetworks.filter(n => !n.isCore);
    const groupMap = new Map();
    for (const net of customNets) {
      const groupName = net.group?.trim() || '';
      if (!groupMap.has(groupName)) groupMap.set(groupName, []);
      groupMap.get(groupName).push(net);
    }

    // Named groups first (sorted), ungrouped last
    const sortedGroupNames = [...groupMap.keys()].filter(g => g).sort();
    for (const gName of sortedGroupNames) {
      groups.push({
        name: gName,
        key: `grp_${gName}`,
        icon: 'fa-folder',
        iconClass: '--custom',
        collapsed: this._collapsedNetGroups.has(`grp_${gName}`),
        networks: groupMap.get(gName),
        count: groupMap.get(gName).length,
      });
    }

    // Ungrouped custom networks
    const ungrouped = groupMap.get('') ?? [];
    if (ungrouped.length) {
      groups.push({
        name: customNets.length === ungrouped.length && !sortedGroupNames.length
          ? 'Custom Subnets'
          : 'Ungrouped',
        key: '_ungrouped',
        icon: 'fa-puzzle-piece',
        iconClass: '--custom',
        collapsed: this._collapsedNetGroups.has('_ungrouped'),
        networks: ungrouped,
        count: ungrouped.length,
      });
    }

    return groups;
  }

  // ═══════════════════════════════════════════════════════════
  //  Data Helpers — Sprint 6: Networks Tab Enhancements
  // ═══════════════════════════════════════════════════════════

  /**
   * Build the scene quick strip data. Active scene sorted first.
   * @returns {Array<object>}
   * @private
   */
  _gatherSceneStrip() {
    const currentSceneId = canvas.scene?.id;
    const allNetworks = this.networkService?.getAllNetworks?.() ?? [];

    return (game.scenes?.contents ?? []).map(s => {
      const deadZone = s.getFlag(MODULE_ID, 'deadZone') ?? false;
      const defaultNetId = s.getFlag(MODULE_ID, 'defaultNetwork') ?? '';
      const defaultNet = allNetworks.find(n => n.id === defaultNetId || n.name === defaultNetId);
      const signalPct = deadZone ? 0 : (defaultNet?.signalStrength ?? 85);
      return {
        id: s.id,
        name: s.name,
        isCurrent: s.id === currentSceneId,
        deadZone,
        defaultNetworkName: deadZone ? 'DEAD ZONE' : (defaultNet?.name ?? 'CITINET'),
        signalPct,
      };
    }).sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Gather connected (non-GM) player data for the War Room player cards.
   * @param {Array<object>} networks - Already-gathered network data
   * @returns {Array<object>}
   * @private
   */
  _gatherConnectedPlayers(networks) {
    const players = [];
    const onlineUsers = game.users?.filter(u => u.active && !u.isGM) ?? [];
    const currentNetId = this.networkService?.currentNetworkId ?? 'CITINET';

    // Icon class mapping for known network types
    const NET_CLASS_MAP = {
      citinet: 'citinet', darknet: 'darknet', corpnet: 'corpnet',
      govnet: 'govnet', dead_zone: 'dead', deadzone: 'dead',
    };
    const NET_ICON_MAP = {
      citinet: 'fa-wifi', darknet: 'fa-mask', corpnet: 'fa-building',
      govnet: 'fa-landmark', dead_zone: 'fa-ban', deadzone: 'fa-ban',
    };

    for (const user of onlineUsers) {
      const actor = user.character;
      // Try to determine the player's current network from their actor flags
      const playerNetId = actor?.getFlag?.(MODULE_ID, 'currentNetwork') ?? currentNetId;
      const net = networks.find(n => n.id === playerNetId || n.name === playerNetId);
      const netIdLower = (playerNetId || '').toLowerCase().replace(/\s+/g, '_');

      const signal = net?.signal ?? 0;
      const isDead = netIdLower === 'dead_zone' || netIdLower === 'deadzone' || signal === 0;
      let signalTier, statusText, signalIcon;

      if (isDead) {
        signalTier = 'dead';
        statusText = 'No signal · All comms blocked';
        signalIcon = 'fa-signal-slash';
      } else if (signal >= 70) {
        signalTier = 'ok';
        statusText = 'Connected · Strong signal';
        signalIcon = 'fa-signal';
      } else if (signal >= 40) {
        signalTier = 'weak';
        statusText = 'Connected · Weak signal';
        signalIcon = 'fa-signal';
      } else {
        signalTier = 'weak';
        statusText = 'Connected · Very weak signal';
        signalIcon = 'fa-signal';
      }

      players.push({
        userId: user.id,
        name: actor?.name ?? user.name,
        img: actor?.img || actor?.prototypeToken?.texture?.src || null,
        networkId: playerNetId,
        networkName: net?.name ?? playerNetId ?? 'Unknown',
        netClass: NET_CLASS_MAP[netIdLower] || 'custom',
        netIcon: NET_ICON_MAP[netIdLower] || 'fa-network-wired',
        signal,
        signalTier,
        statusText,
        signalIcon,
      });
    }

    return players;
  }

  /**
   * Build filtered log entries for the full activity log panel.
   * @returns {Array<object>}
   * @private
   */
  _gatherFullLogEntries() {
    if (this._networkSubView !== 'logs') return [];

    const filters = { limit: 100 };

    // Type filter
    if (this._logTypeFilter === 'connect') {
      filters.type = 'connect';
    } else if (this._logTypeFilter === 'auth') {
      // Match both auth_success and auth_failure — do post-filter
    } else if (this._logTypeFilter === 'hack') {
      filters.type = 'hack';
    } else if (this._logTypeFilter === 'lockout') {
      filters.type = 'lockout';
    } else if (this._logTypeFilter === 'manual') {
      // Post-filter by manual flag
    }

    // Network filter
    if (this._logNetworkFilter) {
      filters.networkId = this._logNetworkFilter;
    }

    let entries = this.accessLogService?.getEntries(filters) ?? [];

    // Post-filter for auth (both success and failure)
    if (this._logTypeFilter === 'auth') {
      entries = entries.filter(e => e.type === 'auth_success' || e.type === 'auth_failure');
    }

    // Post-filter for manual
    if (this._logTypeFilter === 'manual') {
      entries = entries.filter(e => e.manual === true);
    }

    return entries.map(e => this._formatLogEntry(e));
  }

  /**
   * Format a single log entry for template display.
   * @param {object} e - Raw AccessLogEntry
   * @returns {object} Formatted entry
   * @private
   */
  _formatLogEntry(e) {
    return {
      ...e,
      displayTime: this._formatLogTime(e.timestamp),
      displayDate: this._formatLogDate(e.timestamp),
      typeIcon: this._getLogTypeIcon(e.type),
      typeClass: this._getLogTypeClass(e.type),
      typeLabel: this._getLogTypeLabel(e.type),
      colorVar: this._getLogTypeColor(e.type, e.manual),
      actorName: e.actorName ?? 'System',
      networkName: e.networkName ?? e.networkId ?? '—',
      message: e.message ?? e.type ?? '',
    };
  }

  /** @private */
  _formatLogTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  /** @private */
  _formatLogDate(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}.${d.getFullYear()}`;
  }

  /** @private */
  _getLogTypeIcon(type) {
    const icons = {
      connect: 'fa-plug',
      disconnect: 'fa-plug-circle-xmark',
      auth_success: 'fa-lock-open',
      auth_failure: 'fa-lock',
      lockout: 'fa-ban',
      dead_zone: 'fa-signal-slash',
      network_switch: 'fa-arrows-rotate',
      hack: 'fa-skull-crossbones',
      manual: 'fa-user-secret',
      malware: 'fa-virus',
      system: 'fa-signal-slash',
    };
    return icons[type] ?? 'fa-circle-info';
  }

  /** @private */
  _getLogTypeClass(type) {
    const map = {
      connect: 'connect',
      disconnect: 'disconnect',
      auth_success: 'auth',
      auth_failure: 'disconnect',
      lockout: 'disconnect',
      dead_zone: 'disconnect',
      network_switch: 'switch',
      hack: 'hack',
      manual: 'manual',
      malware: 'manual',
      system: 'disconnect',
    };
    return map[type] || 'switch';
  }

  /** @private */
  _getLogTypeLabel(type) {
    const labels = {
      connect: 'CONNECT',
      disconnect: 'DISCONNECT',
      auth_success: 'AUTH OK',
      auth_failure: 'AUTH FAIL',
      lockout: 'LOCKOUT',
      dead_zone: 'DEAD ZONE',
      network_switch: 'SWITCH',
      hack: 'HACK',
      manual: 'TRACE',
      malware: 'MALWARE',
      system: 'SYSTEM',
    };
    return labels[type] || type?.toUpperCase() || 'EVENT';
  }

  /** @private */
  _getLogTypeColor(type, isManual) {
    if (isManual) return 'purple';
    const map = {
      connect: 'success',
      disconnect: 'danger',
      auth_success: 'accent',
      auth_failure: 'danger',
      lockout: 'danger',
      dead_zone: 'danger',
      network_switch: 'secondary',
      hack: 'primary',
      manual: 'purple',
      malware: 'purple',
      system: 'danger',
    };
    return map[type] || 'secondary';
  }

  /**
   * Find any item by ID — checks world items first, then all actor inventories.
   * @param {string} itemId
   * @returns {Item|null}
   * @private
   */
  static _findItem(itemId) {
    // World-level items
    const worldItem = game.items?.get(itemId);
    if (worldItem) return worldItem;

    // Actor-owned items
    for (const actor of game.actors ?? []) {
      const owned = actor.items?.get(itemId);
      if (owned) return owned;
    }
    return null;
  }

  /**
   * Collect ALL data shard items — world-level + actor-owned.
   * @returns {Item[]}
   * @private
   */
  static _getAllDataShards() {
    const shards = [];

    // World-level items
    for (const item of game.items ?? []) {
      if (item.getFlag(MODULE_ID, 'isDataShard') === true) shards.push(item);
    }

    // Actor-owned items
    for (const actor of game.actors ?? []) {
      for (const item of actor.items ?? []) {
        if (item.getFlag(MODULE_ID, 'isDataShard') === true) shards.push(item);
      }
    }

    return shards;
  }

  /**
   * Gather data shard summary for the Shards tab (Sprint 4.6 expansion).
   * Surfaces preset, integrity, eddies totals, connection mode, and enriched status.
   * @returns {Array<object>}
   * @private
   */
  _gatherShardData() {
    const shards = [];

    try {
      const allShards = AdminPanelApp._getAllDataShards();
      const svc = this.dataShardService;

      for (const item of allShards) {
        const config = svc?.getConfig(item) ?? item.getFlag(MODULE_ID, 'config') ?? {};
        const state = svc?.getState(item) ?? item.getFlag(MODULE_ID, 'state') ?? {};
        const integrity = svc?.checkIntegrity(item) ?? { enabled: false, percentage: 100, tier: 'clean' };

        // Preset info
        const presetKey = config.preset || 'blank';
        const preset = game.nightcity?.dataShardService?.getPreset(presetKey);

        // Determine status
        let status = 'locked';
        if (state.destroyed || integrity.isBricked) {
          status = 'destroyed';
        } else if (state.decrypted) {
          status = 'breached';
        } else if (config.encryptionType === 'BLACK_ICE' || config.encryptionType === 'RED_ICE') {
          status = 'blackice';
        } else if (!config.encrypted && !config.requiresLogin && !(config.network?.required ?? config.requiresNetwork)) {
          status = 'open';
        }

        // ICE stripe class
        let iceStripe = 'none';
        if (config.encryptionType === 'RED_ICE') iceStripe = 'red';
        else if (config.encryptionType === 'BLACK_ICE') iceStripe = 'black';
        else if (config.encrypted) iceStripe = 'ice';
        if (state.decrypted) iceStripe = 'decrypted';
        if (status === 'destroyed') iceStripe = 'destroyed';

        // Build security badges
        const badges = [];
        if (state.decrypted) {
          badges.push({ type: 'green', icon: 'fa-unlock', label: 'Breached' });
        } else if (status === 'destroyed') {
          badges.push({ type: 'danger', icon: 'fa-skull-crossbones', label: 'Destroyed' });
        } else if (status === 'open') {
          badges.push({ type: 'muted', icon: 'fa-lock-open', label: 'Open' });
        } else if (config.encrypted) {
          badges.push({ type: 'red', icon: 'fa-lock', label: 'Locked' });
        }

        const netConfig = config.network ?? {};
        if (netConfig.required ?? config.requiresNetwork) {
          const netId = netConfig.allowedNetworks?.[0] ?? config.requiredNetwork ?? null;
          const netName = netId ? (this.networkService?.getNetwork(netId)?.name ?? netId) : 'Network';
          badges.push({ type: 'muted', icon: 'fa-network-wired', label: netName });
        }
        if (netConfig.connectionMode === 'tethered') {
          badges.push({ type: 'cyan', icon: 'fa-link', label: 'Tethered' });
        }

        // Integrity badge
        if (integrity.enabled && integrity.percentage < 75) {
          badges.push({ type: 'danger', icon: 'fa-triangle-exclamation', label: `${integrity.percentage}%` });
        }

        // Owner info — for grouping
        let ownerKey = 'world';
        let ownerName = 'World Items';
        let ownerIcon = 'fas fa-box-open';
        let ownerImg = null;
        if (item.parent && item.parent instanceof Actor) {
          ownerKey = `actor-${item.parent.id}`;
          ownerName = item.parent.name;
          ownerIcon = 'fas fa-user';
          ownerImg = item.parent.img || item.parent.prototypeToken?.texture?.src || null;
        } else if (item.compendium) {
          ownerKey = 'compendium';
          ownerName = 'Compendium';
          ownerIcon = 'fas fa-book';
        }

        // Count entries + eddies
        const journalId = item.getFlag(MODULE_ID, 'journalId');
        const journal = journalId ? game.journal.get(journalId) : null;
        const entryCount = journal?.pages?.size ?? 0;
        let totalEddies = 0;
        let claimedEddies = 0;
        let unclaimedEddies = 0;
        let corruptedCount = 0;

        if (journal) {
          for (const page of journal.pages) {
            const flags = page.flags?.[MODULE_ID];
            if (flags?.contentType === 'eddies' && flags?.contentData) {
              const amt = flags.contentData.amount ?? 0;
              totalEddies += amt;
              if (flags.contentData.claimed) claimedEddies += amt;
              else unclaimedEddies += amt;
            }
            if (flags?.corrupted) corruptedCount++;
          }
        }

        // Eddies badges — separate claimed vs unclaimed
        if (unclaimedEddies > 0) {
          badges.push({ type: 'gold', icon: 'fa-coins', label: `${unclaimedEddies.toLocaleString()} eb` });
        }
        if (claimedEddies > 0) {
          badges.push({ type: 'muted', icon: 'fa-coins', label: `${claimedEddies.toLocaleString()} eb claimed` });
        }

        // Count attempts + breached by + last accessed
        const sessions = state.sessions ?? {};
        let attemptCount = 0;
        let breachedBy = null;
        let lastAccessedTs = 0;
        for (const [actorId, session] of Object.entries(sessions)) {
          attemptCount += session.hackAttempts ?? 0;
          if (session.loggedIn || state.decrypted) {
            const actor = game.actors?.get(actorId);
            if (actor) breachedBy = actor.name;
          }
          // Track most recent access timestamp
          const ts = session.lastAccessed ?? session.lastLogin ?? 0;
          if (ts > lastAccessedTs) lastAccessedTs = ts;
        }

        // Format last accessed
        let lastAccessedLabel = 'Never';
        let lastAccessedRecent = false;
        if (lastAccessedTs > 0) {
          const ago = Date.now() - lastAccessedTs;
          if (ago < 60000) { lastAccessedLabel = 'Just now'; lastAccessedRecent = true; }
          else if (ago < 3600000) { lastAccessedLabel = `${Math.floor(ago / 60000)}m ago`; lastAccessedRecent = ago < 600000; }
          else if (ago < 86400000) { lastAccessedLabel = `${Math.floor(ago / 3600000)}h ago`; }
          else { lastAccessedLabel = `${Math.floor(ago / 86400000)}d ago`; }
        }

        // Preset icon + label + color class
        const presetIcon = preset?.icon || config.boot?.faIcon || 'fas fa-microchip';
        const presetLabel = preset?.label || 'Custom';
        const ICON_CLASS_MAP = {
          'corporate-dossier': 'corp',
          'military-intel': 'mil',
          'fixer-dead-drop': 'fixer',
          'street-shard': 'street',
          'black-market': 'black',
          'personal-memory': 'memory',
          'media-leak': 'media',
          'netwatch-evidence': 'nw',
          'blank': '',
        };
        const presetIconClass = ICON_CLASS_MAP[presetKey] || '';

        // Meta line
        const metaParts = [presetLabel];
        if (config.encrypted) {
          metaParts.push(`<span style="color:${iceStripe === 'red' ? '#cc0000' : iceStripe === 'black' ? 'var(--ncm-danger)' : 'var(--ncm-accent)'}">${config.encryptionType}</span>`);
          metaParts.push(`DV ${config.encryptionDC}`);
        }
        metaParts.push(netConfig.connectionMode === 'tethered' ? 'Tethered' : 'Offline');

        // Security layers for expand preview
        const layers = [];
        if (netConfig.required ?? config.requiresNetwork) layers.push({ key: 'network', name: 'Network', cleared: !!Object.values(sessions).find(s => s.hackedLayers?.includes('network')) || status === 'breached' || status === 'open' });
        if (config.requiresKeyItem) layers.push({ key: 'keyitem', name: 'Key Item', cleared: !!Object.values(sessions).find(s => s.keyItemUsed) });
        if (config.requiresLogin) layers.push({ key: 'login', name: 'Login', cleared: !!Object.values(sessions).find(s => s.loggedIn) });
        if (config.encrypted) layers.push({ key: 'encryption', name: 'Encryption', cleared: state.decrypted });

        // First entry preview snippet
        let firstEntrySnippet = '';
        if (journal?.pages?.size) {
          const firstPage = journal.pages.contents[0];
          const pageFlags = firstPage?.flags?.[MODULE_ID];
          firstEntrySnippet = pageFlags?.body || pageFlags?.contentData?.message || firstPage?.text?.content || '';
          if (firstEntrySnippet.length > 200) firstEntrySnippet = firstEntrySnippet.slice(0, 200) + '...';
          // Strip HTML tags
          firstEntrySnippet = firstEntrySnippet.replace(/<[^>]+>/g, '');
        }

        shards.push({
          itemId: item.id,
          name: config.shardName || item.name,
          ownerKey,
          ownerName,
          ownerIcon,
          ownerImg,
          status,
          iceStripe,
          presetKey,
          presetLabel,
          presetIcon,
          presetIconClass,
          metaLine: metaParts.join(' <span class="ncm-shard-row__meta-sep">·</span> '),
          badges,
          entryCount,
          corruptedCount,
          attemptCount,
          breachedBy,
          // Integrity
          integrityEnabled: integrity.enabled,
          integrityPercent: integrity.percentage,
          integrityTier: integrity.tier,
          // Eddies
          totalEddies,
          claimedEddies,
          unclaimedEddies,
          hasUnclaimed: unclaimedEddies > 0,
          // v4 fields
          lastAccessedLabel,
          lastAccessedRecent,
          lastAccessedTs,
          isSelected: this._selectedShardIds.has(item.id),
          isExpanded: this._expandedShardId === item.id,
          isDecrypted: state.decrypted ?? false,
          layers,
          firstEntrySnippet,
          hasLayers: layers.length > 0,
        });
      }
    } catch (error) {
      console.error(`${MODULE_ID} | AdminPanelApp._gatherShardData:`, error);
    }

    // Apply search filter
    let filtered = shards;
    if (this._shardSearch) {
      const q = this._shardSearch.toLowerCase();
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.ownerName.toLowerCase().includes(q) ||
        s.presetLabel.toLowerCase().includes(q)
      );
    }

    // Apply ICE filter
    if (this._shardIceFilter !== 'all') {
      filtered = filtered.filter(s => {
        if (this._shardIceFilter === 'none') return s.iceStripe === 'none';
        return s.iceStripe === this._shardIceFilter;
      });
    }

    // Apply status filter
    if (this._shardStatusFilter !== 'all') {
      filtered = filtered.filter(s => {
        if (this._shardStatusFilter === 'locked') return s.status === 'locked' || s.status === 'blackice';
        return s.status === this._shardStatusFilter;
      });
    }

    // Apply owner filter
    if (this._shardOwnerFilter !== 'all') {
      filtered = filtered.filter(s => {
        if (this._shardOwnerFilter === 'world') return s.ownerKey === 'world';
        return s.ownerKey !== 'world'; // 'actors'
      });
    }

    // Apply sort
    filtered.sort((a, b) => {
      switch (this._shardSort) {
        case 'status': return a.status.localeCompare(b.status);
        case 'accessed': return (b.lastAccessedTs || 0) - (a.lastAccessedTs || 0);
        default: return a.name.localeCompare(b.name);
      }
    });

    return filtered;
  }

  /**
   * Group shards by owner for the v4 collapsible group layout.
   * Each group has: key, name, icon, img, shards[], statusPips, statusText, shardCount.
   * @param {Array<object>} shards
   * @returns {Array<object>}
   * @private
   */
  _buildShardGroups(shards) {
    const mode = this._shardGroupMode || 'owner';

    // 'none' mode — single flat group
    if (mode === 'none') {
      return [this._buildGroupSummary({ key: 'all', name: 'All Shards', icon: 'fas fa-database', img: null, isWorld: false, shards })];
    }

    // Build groups map based on mode
    const groupMap = new Map();
    for (const shard of shards) {
      let groupKey, groupName, groupIcon, groupImg, isWorld;

      switch (mode) {
        case 'preset':
          groupKey = shard.presetKey || 'blank';
          groupName = shard.presetLabel || 'Custom';
          groupIcon = shard.presetIcon || 'fas fa-microchip';
          groupImg = null;
          isWorld = false;
          break;

        case 'status':
          groupKey = shard.status;
          const STATUS_LABELS = { locked: 'Locked', blackice: 'BLACK ICE', breached: 'Breached', open: 'Open', destroyed: 'Destroyed' };
          const STATUS_ICONS = { locked: 'fas fa-lock', blackice: 'fas fa-skull', breached: 'fas fa-unlock', open: 'fas fa-lock-open', destroyed: 'fas fa-skull-crossbones' };
          groupName = STATUS_LABELS[shard.status] || shard.status;
          groupIcon = STATUS_ICONS[shard.status] || 'fas fa-circle';
          groupImg = null;
          isWorld = false;
          break;

        default: // 'owner'
          groupKey = shard.ownerKey;
          groupName = shard.ownerName;
          groupIcon = shard.ownerIcon;
          groupImg = shard.ownerImg;
          isWorld = shard.ownerKey === 'world';
          break;
      }

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, { key: groupKey, name: groupName, icon: groupIcon, img: groupImg, isWorld, shards: [] });
      }
      groupMap.get(groupKey).shards.push(shard);
    }

    // Build final groups with summaries
    const groups = [...groupMap.values()].map(g => this._buildGroupSummary(g));

    // Sort: world/all first, then alphabetical
    groups.sort((a, b) => {
      if (a.isWorld) return -1;
      if (b.isWorld) return 1;
      return a.name.localeCompare(b.name);
    });

    return groups;
  }

  /**
   * Build status pips and summary text for a shard group.
   * @private
   */
  _buildGroupSummary(group) {
    const locked = group.shards.filter(s => s.status === 'locked' || s.status === 'blackice').length;
    const breached = group.shards.filter(s => s.status === 'breached').length;
    const open = group.shards.filter(s => s.status === 'open').length;
    const destroyed = group.shards.filter(s => s.status === 'destroyed').length;

    const pips = group.shards.map(s => ({ class: s.status === 'blackice' ? 'blackice' : s.status }));

    const parts = [];
    if (locked > 0) parts.push(`<span style="color:var(--ncm-color-primary,#F65261);">${locked}</span> locked`);
    if (breached > 0) parts.push(`<span style="color:var(--ncm-success,#00ff41);">${breached}</span> breached`);
    if (open > 0) parts.push(`${open} open`);
    if (destroyed > 0) parts.push(`<span style="color:var(--ncm-danger,#ff0033);">${destroyed}</span> destroyed`);

    return {
      ...group,
      shardCount: group.shards.length,
      pips,
      statusText: parts.join(' · '),
      collapsed: this._collapsedShardGroups.has(group.key),
    };
  }

  /**
   * Gather recent access log for shards (from event history or flags).
   * @returns {Array<object>}
   * @private
   */
  _gatherAccessLog() {
    // Access log is stored in module settings or state — adapt to your storage approach
    try {
      const rawLog = game.settings?.get(MODULE_ID, 'accessLog') ?? [];
      return rawLog.slice(0, 10).map(entry => ({
        type: entry.success ? 'success' : (entry.gm ? 'gm' : 'fail'),
        icon: entry.success ? 'check' : (entry.gm ? 'shield-halved' : 'xmark'),
        text: entry.text || 'Unknown event',
        time: this._getRelativeTime(entry.timestamp),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Gather recent contact push log.
   * @returns {Array<object>}
   * @private
   */
  _gatherPushLog() {
    try {
      const rawLog = game.settings?.get(MODULE_ID, 'pushLog') ?? [];
      return rawLog.slice(0, 5).map(entry => ({
        text: entry.text || 'Contact pushed',
        time: this._getRelativeTime(entry.timestamp),
      }));
    } catch {
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Format Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Format a scheduled entry for display.
   * @param {object} entry - Raw scheduled entry
   * @returns {object}
   * @private
   */
  _formatScheduledEntry(entry) {
    const fromActor = game.actors.get(entry.messageData?.fromActorId);
    const toActor = game.actors.get(entry.messageData?.toActorId);

    const now = Date.now();
    const deliveryMs = new Date(entry.deliveryTime).getTime();
    const diffMs = Math.max(0, deliveryMs - now);
    const diffSec = Math.floor(diffMs / 1000);

    const hours = Math.floor(diffSec / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    const secs = diffSec % 60;
    const countdown = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const isSoon = diffMs < 5 * 60 * 1000; // < 5 minutes

    // Delivery date in cyberpunk format
    const dt = new Date(entry.deliveryTime);
    const deliveryDate = `${dt.getDate().toString().padStart(2, '0')}.${(dt.getMonth() + 1).toString().padStart(2, '0')}.${dt.getFullYear()} // ${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;

    // Priority
    const priority = entry.messageData?.priority || 'normal';

    // From color
    const fromColor = fromActor?.hasPlayerOwner
      ? 'var(--ncm-secondary)'
      : (priority === 'critical' ? 'var(--ncm-danger)' : 'var(--ncm-accent)');

    return {
      ...entry,
      fromName: fromActor?.name ?? entry.messageData?.from ?? 'Unknown',
      toName: toActor?.name ?? entry.messageData?.to ?? 'Unknown',
      subject: entry.messageData?.subject ?? '(no subject)',
      countdown,
      isSoon,
      deliveryDate,
      priority,
      fromColor,
    };
  }

  /**
   * Get relative time string (e.g. "2m ago", "1h ago").
   * @param {string|number} timestamp
   * @returns {string}
   * @private
   */
  _getRelativeTime(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const then = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    const diffMs = now - then;

    if (diffMs < 60_000) return 'Just now';
    if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
    return `${Math.floor(diffMs / 86400_000)}d ago`;
  }

  /**
   * Format session time for a user.
   * @param {User} user
   * @returns {string}
   * @private
   */
  _formatSessionTime(user) {
    // Foundry doesn't track session start natively — use placeholder
    // In a real implementation, track via socket or module settings
    return '—';
  }

  // ═══════════════════════════════════════════════════════════
  //  Render Lifecycle
  // ═══════════════════════════════════════════════════════════

  /**
   * After render: restore scroll position + wire controls.
   * Scroll SAVING is handled by a passive listener attached below,
   * which continuously updates _scrollPositions as the user scrolls.
   * This avoids the timing problem where _onRender fires after DOM
   * replacement (scrollTop already 0 on the new element).
   */
  _onRender(context, options) {
    super._onRender(context, options);

    // Restore scroll position after render
    requestAnimationFrame(() => {
      const el = this.element?.querySelector('.ncm-admin-content');
      if (el && this._scrollPositions[this._activeTab]) {
        el.scrollTop = this._scrollPositions[this._activeTab];
      }

      // Attach passive scroll listener to continuously track position
      this._attachScrollTracker(el);
    });

    // ── Contacts tab: wire search + sort inputs ──
    if (this._activeTab === 'contacts') {
      this._setupContactsControls();
    }

    // ── Networks tab: wire signal sliders + network filter select ──
    if (this._activeTab === 'networks') {
      this._setupNetworkControls();
    }

    // ── Shards tab: wire search input ──
    if (this._activeTab === 'shards') {
      this._setupShardControls();
    }
  }

  /**
   * Attach a passive scroll listener to the content area.
   * Continuously saves scroll position so it's always up-to-date
   * before any render cycle.
   * @param {HTMLElement} el
   * @private
   */
  _attachScrollTracker(el) {
    if (!el) return;
    // Remove previous listener if element changed
    if (this._scrollEl && this._scrollEl !== el) {
      this._scrollEl.removeEventListener('scroll', this._scrollHandler);
    }
    if (this._scrollEl === el) return; // Already attached

    this._scrollEl = el;
    this._scrollHandler = () => {
      if (this._activeTab) {
        this._scrollPositions[this._activeTab] = el.scrollTop;
      }
    };
    el.addEventListener('scroll', this._scrollHandler, { passive: true });
  }

  /**
   * Wire up contacts tab search input and sort select with debounced handlers.
   */
  _setupContactsControls() {
    // Search input — new v6 class
    const searchInput = this.element?.querySelector('.ncm-ct-search__input');
    if (searchInput) {
      if (this._contactSearch) searchInput.focus();

      const handler = this._contactSearchHandler || (this._contactSearchHandler =
        foundry.utils.debounce((e) => {
          this._contactSearch = e.target.value;
          this.render(true);
        }, 250)
      );
      searchInput.removeEventListener('input', handler);
      searchInput.addEventListener('input', handler);
    }

    // Sort select — new v6 class
    const sortSelect = this.element?.querySelector('.ncm-ct-search__sort');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this._contactSort = e.target.value;
        this.render(true);
      });
    }

    // Close overflow menu when clicking outside
    const overflowBtn = this.element?.querySelector('.ncm-ct-overflow__btn');
    if (overflowBtn && this._contactOverflowOpen) {
      const closeOverflow = (e) => {
        if (!e.target.closest('.ncm-ct-overflow')) {
          this._contactOverflowOpen = false;
          this.render(true);
          document.removeEventListener('click', closeOverflow);
        }
      };
      setTimeout(() => document.addEventListener('click', closeOverflow), 0);
    }
  }

  /**
   * Wire up signal sliders and network filter select on the Networks tab.
   * Range sliders use input/change events which don't work with data-action.
   */
  _setupNetworkControls() {
    // ─── Mixer: Real-time drag on slider tracks ───
    this.element?.querySelectorAll('.ncm-mixer-ch__slider-track')?.forEach(track => {
      const channel = track.closest('.ncm-mixer-ch');
      const networkId = track.dataset?.networkId || channel?.dataset?.networkId;
      if (!networkId) return;

      const fill = track.querySelector('.ncm-mixer-ch__slider-fill');
      const thumb = track.querySelector('.ncm-mixer-ch__slider-thumb');
      const pctInput = channel?.querySelector('.ncm-mixer-ch__pct-input');

      const updateVisual = (pct) => {
        if (fill) fill.style.height = `${pct}%`;
        if (thumb) thumb.style.bottom = `calc(${pct}% - 3px)`;
        if (pctInput) pctInput.value = pct;
        // Update fill color class
        if (fill) {
          fill.className = fill.className.replace(/ncm-mixer-ch__slider-fill--\w+/g, '');
          fill.classList.add('ncm-mixer-ch__slider-fill');
          if (pct >= 70) fill.classList.add('ncm-mixer-ch__slider-fill--good');
          else if (pct >= 40) fill.classList.add('ncm-mixer-ch__slider-fill--mid');
          else if (pct > 0) fill.classList.add('ncm-mixer-ch__slider-fill--low');
          else fill.classList.add('ncm-mixer-ch__slider-fill--dead');
        }
      };

      const calcPct = (e) => {
        const rect = track.getBoundingClientRect();
        const y = e.clientY - rect.top;
        return Math.round(Math.max(0, Math.min(100, (1 - y / rect.height) * 100)));
      };

      track.addEventListener('mousedown', (e) => {
        e.preventDefault();
        let pct = calcPct(e);
        updateVisual(pct);

        const onMove = (ev) => { pct = calcPct(ev); updateVisual(pct); };
        const onUp = async () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          await this.networkService?.updateNetwork(networkId, { signalStrength: pct });
          log.info(`Admin: Signal for ${networkId} set to ${pct}%`);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });

    // ─── Mixer: Editable percentage input ───
    this.element?.querySelectorAll('.ncm-mixer-ch__pct-input')?.forEach(input => {
      const networkId = input.dataset.networkId;
      if (!networkId) return;
      input.addEventListener('change', async () => {
        const val = Math.max(0, Math.min(100, Number(input.value) || 0));
        input.value = val;
        await this.networkService?.updateNetwork(networkId, { signalStrength: val });
        log.info(`Admin: Signal for ${networkId} set to ${val}% (manual input)`);
        this.render();
      });
    });

    // ─── Network filter dropdown in full log panel ───
    const netFilter = this.element?.querySelector('.ncm-netlog-network-filter');
    if (netFilter) {
      netFilter.addEventListener('change', (e) => {
        this._logNetworkFilter = e.target.value;
        this.render(true);
      });
    }

    // ─── Network search input — debounced ───
    const searchInput = this.element?.querySelector('.ncm-net-config-search__input');
    if (searchInput) {
      if (this._networkSearch) {
        searchInput.value = this._networkSearch;
        searchInput.focus();
        const len = this._networkSearch.length;
        searchInput.setSelectionRange(len, len);
      }

      const handler = this._networkSearchHandler || (this._networkSearchHandler =
        foundry.utils.debounce((e) => {
          this._networkSearch = e.target.value;
          this.render(true);
        }, 350)
      );
      searchInput.removeEventListener('input', handler);
      searchInput.addEventListener('input', handler);
    }
  }

  /**
   * Wire up shard tab search input with debounced handler.
   */
  _setupShardControls() {
    const searchInput = this.element?.querySelector('.ncm-shard-search__input');
    if (searchInput) {
      // Restore cursor position after render
      if (this._shardSearch) {
        searchInput.value = this._shardSearch;
        searchInput.focus();
        const len = this._shardSearch.length;
        searchInput.setSelectionRange(len, len);
      }

      const handler = this._shardSearchHandler || (this._shardSearchHandler =
        foundry.utils.debounce((e) => {
          this._shardSearch = e.target.value;
          this.render(true);
        }, 350)
      );
      searchInput.removeEventListener('input', handler);
      searchInput.addEventListener('input', handler);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Event Subscriptions
  // ═══════════════════════════════════════════════════════════

  _setupEventSubscriptions() {
    // Messages
    this.subscribe(EVENTS.MESSAGE_SENT, () => this._refreshIfTab('overview', 'messages'));
    this.subscribe(EVENTS.MESSAGE_RECEIVED, () => this._refreshIfTab('overview', 'messages'));
    this.subscribe(EVENTS.MESSAGE_SCHEDULED, () => this._refreshIfTab('messages'));
    this.subscribe(EVENTS.MESSAGE_DELETED, () => this._refreshIfTab('overview', 'messages'));
    this.subscribe('schedule:updated', () => this._refreshIfTab('messages'));

    // Contacts
    this.subscribe(EVENTS.CONTACT_TRUST_CHANGED, () => this._refreshIfTab('contacts'));
    this.subscribe(EVENTS.CONTACT_BURNED, () => this._refreshIfTab('contacts'));
    this.subscribe(EVENTS.CONTACT_SHARED, () => this._refreshIfTab('contacts'));
    this.subscribe(EVENTS.CONTACT_UPDATED, () => this._debouncedRender());

    // Networks
    this.subscribe(EVENTS.NETWORK_CHANGED, () => this._refreshIfTab('networks', 'overview'));
    this.subscribe(EVENTS.NETWORK_CONNECTED, () => this._refreshIfTab('networks', 'overview'));
    this.subscribe(EVENTS.NETWORK_DISCONNECTED, () => this._refreshIfTab('networks', 'overview'));
    this.subscribe(EVENTS.NETWORK_AUTH_SUCCESS, () => this._refreshIfTab('networks'));
    this.subscribe(EVENTS.NETWORK_AUTH_FAILURE, () => this._refreshIfTab('networks'));
    this.subscribe(EVENTS.NETWORK_LOCKOUT, () => this._refreshIfTab('networks'));

    // Data Shards
    this.subscribe(EVENTS.SHARD_DECRYPTED, (data) => {
      this._logShardActivity('success', 'check', data, 'breached');
      this._refreshIfTab('shards');
    });
    this.subscribe(EVENTS.SHARD_RELOCKED, (data) => {
      this._logShardActivity('gm', 'lock', data, 'relocked by GM');
      this._refreshIfTab('shards');
    });
    this.subscribe(EVENTS.SHARD_HACK_ATTEMPT, (data) => {
      const type = data.success ? 'success' : 'fail';
      const icon = data.success ? 'check' : 'xmark';
      const text = data.success
        ? `breached (${data.roll} vs DV ${data.dc})`
        : `hack FAILED (${data.roll} vs DV ${data.dc})`;
      this._logShardActivity(type, icon, data, text);
      this._refreshIfTab('shards');
    });
    this.subscribe(EVENTS.SHARD_CREATED, (data) => {
      this._logShardActivity('gm', 'plus', data, 'created');
      this._refreshIfTab('shards');
    });
    this.subscribe(EVENTS.SHARD_STATE_CHANGED, () => this._debouncedRender());
    this.subscribe(EVENTS.SHARD_INTEGRITY_CHANGED, (data) => {
      this._logShardActivity('fail', 'triangle-exclamation', data, `integrity → ${data.newIntegrity}%`);
      this._refreshIfTab('shards');
    });
    this.subscribe(EVENTS.SHARD_EDDIES_CLAIMED, (data) => {
      this._logShardActivity('success', 'coins', data, `claimed ${data.amount?.toLocaleString() ?? '?'} eb`);
      this._refreshIfTab('shards');
    });
    this.subscribe(EVENTS.SHARD_PRESET_APPLIED, (data) => {
      this._logShardActivity('gm', 'palette', data, `preset "${data.preset}" applied`);
      this._refreshIfTab('shards');
    });
  }

  /**
   * Re-render only if the active tab is one of the specified tabs.
   * Also always re-renders the header (stats are in every view).
   * @param {...string} tabs
   * @private
   */
  _refreshIfTab(...tabs) {
    // Always refresh if on one of the target tabs
    if (tabs.includes(this._activeTab)) {
      this.render(true);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Tab Navigation
  // ═══════════════════════════════════════════════════════════

  static _onSwitchTab(event, target) {
    const tab = target.closest('[data-tab]')?.dataset.tab;
    if (!tab) return;

    // Save scroll position of current tab
    const content = this.element?.querySelector('.ncm-admin-content');
    if (content) {
      this._scrollPositions[this._activeTab] = content.scrollTop;
    }

    this._activeTab = tab;
    this.render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Overview
  // ═══════════════════════════════════════════════════════════

  static async _onOpenInbox(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;

    const actor = game.actors.get(actorId);
    if (!actor) return;

    game.nightcity?.openInbox?.(actor);
    log.info(`Admin: Opening inbox for ${actor.name}`);
  }

  static _onOpenAllInboxes(event, target) {
    // Open inbox for each actor with messages — limited to prevent window spam
    const actors = game.actors.filter(a =>
      a.hasPlayerOwner || a.getFlag(MODULE_ID, 'email')
    ).slice(0, 4);

    for (const actor of actors) {
      game.nightcity?.openInbox?.(actor);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Messages
  // ═══════════════════════════════════════════════════════════

  static async _onQuickSend(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;

    const actor = game.actors.get(actorId);
    if (!actor) return;

    // Open composer pre-filled with this NPC as sender
    game.nightcity?.openComposer?.({ fromActorId: actorId, fromName: actor.name });
    log.info(`Admin: Quick-send as ${actor.name}`);
  }

  static _onOpenComposer(event, target) {
    game.nightcity?.openComposer?.();
  }

  static async _onCancelScheduled(event, target) {
    const scheduleId = target.closest('[data-schedule-id]')?.dataset.scheduleId;
    if (!scheduleId) return;

    const confirmed = await Dialog.confirm({
      title: 'Cancel Scheduled Message',
      content: '<p>Cancel this scheduled message? It will not be delivered.</p>',
    });
    if (!confirmed) return;

    const result = await this.schedulingService?.cancelScheduled(scheduleId);
    if (result?.success) {
      ui.notifications.info('Scheduled message cancelled.');
      this.render(true);
    } else {
      ui.notifications.error(result?.error || 'Failed to cancel.');
    }
  }

  static async _onEditScheduled(event, target) {
    const scheduleId = target.closest('[data-schedule-id]')?.dataset.scheduleId;
    if (!scheduleId) return;

    const entry = this.schedulingService?.getEntry?.(scheduleId);
    if (!entry) return;

    game.nightcity?.openComposer?.({
      ...entry.messageData,
      scheduleId,
      editMode: true,
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Contacts
  // ═══════════════════════════════════════════════════════════

  static _onOpenGMContacts(event, target) {
    game.nightcity?.openGMContacts?.();
    log.info('Admin: Opening GM Contact Manager');
  }

  static async _onPushContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;
    // Delegate to the share-to-player dialog
    await this._showShareDialog([contactId]);
  }

  /**
   * Open a player's contact list in GM Inspect Mode.
   * Full edit + verify/unverify access.
   */
  static _onViewPlayerContacts(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId || !game.user.isGM) return;

    const actor = game.actors.get(actorId);
    if (!actor) {
      ui.notifications.warn('Actor not found.');
      return;
    }

    // Import ContactManagerApp dynamically to avoid circular deps
    const ContactManagerApp = game.nightcity?._ContactManagerApp;
    if (!ContactManagerApp) {
      // Fallback: try opening via the standard launch function
      game.nightcity?.openContacts?.(actorId, { gmInspectMode: true });
      return;
    }

    const app = new ContactManagerApp({
      actorId,
      gmInspectMode: true,
    });
    app.render(true);
  }

  /**
   * GM force-verifies a contact from the admin panel context.
   * (Delegates to ContactRepository)
   */
  static async _onGMVerifyContact(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!actorId || !contactId || !game.user.isGM) return;

    const contactRepo = game.nightcity?.contactRepository;
    const result = await contactRepo?.gmOverrideVerification(actorId, contactId, true);

    if (result?.success) {
      ui.notifications.info('Contact force-verified.');
      this.render(true);
    } else {
      ui.notifications.error(result?.error || 'Verification failed.');
    }
  }

  /**
   * GM revokes verification from the admin panel context.
   */
  static async _onGMUnverifyContact(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!actorId || !contactId || !game.user.isGM) return;

    const contactRepo = game.nightcity?.contactRepository;
    const result = await contactRepo?.gmOverrideVerification(actorId, contactId, false);

    if (result?.success) {
      ui.notifications.info('Verification revoked.');
      this.render(true);
    } else {
      ui.notifications.error(result?.error || 'Failed to unverify.');
    }
  }

  /**
   * Open composer as a specific master contact (Send As).
   */
  static _onSendAsContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = game.nightcity?.masterContactService?.getContact(contactId);
    if (!contact) return;

    if (contact.actorId) {
      game.nightcity?.composeMessage?.({ fromActorId: contact.actorId });
    } else {
      game.nightcity?.composeMessage?.({
        fromContact: {
          id: contact.id,
          name: contact.name,
          email: contact.email,
          portrait: contact.portrait || null,
        },
      });
    }
  }

  /**
   * Open the virtual inbox for a master contact.
   */
  static _onOpenContactInbox(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = game.nightcity?.masterContactService?.getContact(contactId);
    if (!contact) return;

    const inboxId = contact.actorId || contactId;
    game.nightcity?.openInbox?.(inboxId);
  }

  /**
   * Open composer to message a specific contact.
   */
  static _onComposeToContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = game.nightcity?.masterContactService?.getContact(contactId);
    if (!contact) return;

    game.nightcity?.composeMessage?.({
      toActorId: contact.actorId || null,
      to: contact.email,
    });
  }

  /**
   * Export all master contacts as JSON.
   */
  static _onExportContacts(event, target) {
    const svc = game.nightcity?.masterContactService;
    if (!svc) return;

    const contacts = svc.getAll?.() || [];
    const data = JSON.stringify(contacts, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-master-contacts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    ui.notifications.info(`Exported ${contacts.length} contacts.`);
  }

  /**
   * Import NPC actors as master contacts.
   */
  /**
   * Import contacts from a JSON file.
   */
  static async _onImportContactsJSON(event, target) {
    const svc = game.nightcity?.masterContactService;
    if (!svc) {
      ui.notifications.warn('Master contact service not available.');
      return;
    }

    // Create a hidden file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const contacts = JSON.parse(text);

        if (!Array.isArray(contacts)) {
          ui.notifications.error('Invalid format — expected a JSON array of contacts.');
          return;
        }

        let imported = 0;
        let skipped = 0;
        const existing = svc.getAll() || [];
        const existingEmails = new Set(existing.map(c => c.email?.toLowerCase()));

        for (const c of contacts) {
          if (!c.name) { skipped++; continue; }
          // Skip duplicates by email
          if (c.email && existingEmails.has(c.email.toLowerCase())) { skipped++; continue; }

          const result = await svc.addContact({
            name: c.name,
            email: c.email || '',
            alias: c.alias || '',
            phone: c.phone || '',
            organization: c.organization || '',
            portrait: c.portrait || '',
            type: c.type || c.role || 'npc',
            tags: c.tags || [],
            notes: c.notes || '',
            relationship: c.relationship || '',
            trust: c.trust ?? 3,
          });
          if (result?.success) {
            imported++;
            existingEmails.add(c.email?.toLowerCase());
          }
        }

        ui.notifications.info(`Imported ${imported} contacts. ${skipped ? `${skipped} skipped (duplicates or invalid).` : ''}`);
        this.render(true);
      } catch (err) {
        console.error('NCM | Import contacts failed:', err);
        ui.notifications.error('Failed to parse JSON file.');
      } finally {
        input.remove();
      }
    });

    input.click();
  }

  /**
   * Set trust on a contact from inline trust bar click.
   */
  static async _onSetContactTrust(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    const trustValue = parseInt(target.dataset.trustValue, 10);
    if (!contactId || isNaN(trustValue)) return;

    const svc = game.nightcity?.masterContactService;
    if (!svc) return;

    await svc.updateContact(contactId, { trust: trustValue });
    this.render(true);
  }

  /**
   * Open the full GM Contact Manager with a specific contact selected for editing.
   */
  /**
   * Open the full GM Contact Manager with a specific contact selected.
   * Shows the detail view for that contact (not edit mode).
   */
  static async _onEditContactInEditor(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    // openGMContacts returns the singleton app instance
    const gmApp = await game.nightcity?.openGMContacts?.();
    if (gmApp) {
      gmApp._selectedContactId = contactId;
      gmApp._isEditing = false;
      gmApp._isCreating = false;
      gmApp.render(true);
    }
  }

  /**
   * Create a new contact via the full GM Contact Manager.
   */
  static async _onCreateNewContact(event, target) {
    const gmApp = await game.nightcity?.openGMContacts?.();
    if (gmApp) {
      gmApp._isCreating = true;
      gmApp._selectedContactId = null;
      gmApp._isEditing = false;
      gmApp.render(true);
    }
  }

  /**
   * Push all contacts to a player (placeholder — needs target picker).
   */
  static _onPushAllContacts(event, target) {
    game.nightcity?.openGMContacts?.();
  }

  /**
   * Set contact filter from a filter pill click.
   */
  static _onContactFilter(event, target) {
    const filter = target.dataset.filter || 'all';
    // Toggle: clicking the active filter resets to 'all'
    this._contactFilter = (this._contactFilter === filter) ? 'all' : filter;
    this.render(true);
  }

  /**
   * Clear the contact search input.
   */
  static _onContactClearSearch(event, target) {
    this._contactSearch = '';
    this.render(true);
  }

  /**
   * Toggle expand/collapse of a contact detail panel (accordion).
   */
  static _onToggleContactExpand(event, target) {
    // Don't toggle if clicking on an action button, checkbox, or trust segment
    const clickedAction = event.target.closest('[data-action]:not([data-action="toggleContactExpand"])');
    if (clickedAction) return;

    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;
    this._expandedContactId = (this._expandedContactId === contactId) ? null : contactId;
    this._contactOverflowOpen = false;
    this.render(true);
  }

  /**
   * Toggle a contact's selection checkbox.
   */
  static _onToggleContactSelect(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const contactId = target.dataset.contactId || target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;
    if (this._selectedContacts.has(contactId)) {
      this._selectedContacts.delete(contactId);
    } else {
      this._selectedContacts.add(contactId);
    }
    this.render(true);
  }

  /**
   * Clear all contact selections.
   */
  static _onClearContactSelection() {
    this._selectedContacts.clear();
    this.render(true);
  }

  /**
   * Toggle a contact group's collapsed state.
   */
  static _onToggleContactGroup(event, target) {
    const groupKey = target.dataset.group || target.closest('[data-group]')?.dataset.group;
    if (!groupKey) return;
    if (this._collapsedContactGroups.has(groupKey)) {
      this._collapsedContactGroups.delete(groupKey);
    } else {
      this._collapsedContactGroups.add(groupKey);
    }
    this.render(true);
  }

  /**
   * Toggle the overflow menu.
   */
  static _onToggleContactOverflow(event, target) {
    event.preventDefault();
    event.stopPropagation();
    this._contactOverflowOpen = !this._contactOverflowOpen;
    this.render(true);
  }

  /**
   * Burn a single contact.
   */
  static async _onBurnContact(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const contactId = target.dataset.contactId || target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = this.masterContactService?.getContact(contactId);
    if (!contact) return;

    const confirm = await Dialog.confirm({
      title: 'Burn Contact',
      content: `<p>Mark <b>${contact.name}</b> as burned (compromised)?</p><p>This will mark the contact as burned for all players.</p>`,
    });
    if (!confirm) return;

    await this.masterContactService.updateContact(contactId, { burned: true });
    ui.notifications.info(`NCM | ${contact.name} has been burned.`);
    this.render(true);
  }

  /**
   * Share a single contact to players via dialog.
   */
  static async _onShareContactToPlayer(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const contactId = target.dataset.contactId || target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;
    await this._showShareDialog([contactId]);
  }

  /**
   * Sync contacts from world actors — creates master contacts for actors with NCM emails.
   */
  static async _onSyncFromActors(event, target) {
    event.preventDefault();
    event.stopPropagation();
    this._contactOverflowOpen = false;

    const confirmed = await Dialog.confirm({
      title: 'Sync from Actors',
      content: `<p>Create master contacts for all world actors that have an NCM email assigned but aren't already in the directory?</p>`,
    });
    if (!confirmed) { this.render(true); return; }

    const result = await this.masterContactService?.importFromActors();
    if (result?.success) {
      ui.notifications.info(`NCM | Imported ${result.imported} contact${result.imported !== 1 ? 's' : ''} from world actors.`);
    } else {
      ui.notifications.warn('NCM | Sync failed.');
    }
    this.render(true);
  }

  /**
   * Batch: share selected contacts with players via dialog.
   */
  static async _onBatchShareContacts() {
    if (!this._selectedContacts.size) return;
    await this._showShareDialog([...this._selectedContacts]);
  }

  /**
   * Batch: tag selected contacts via dialog.
   */
  static async _onBatchTagContacts() {
    if (!this._selectedContacts.size) return;
    const count = this._selectedContacts.size;

    // Build existing tags list for suggestions
    const existingTags = this.masterContactService?.getAllTags() ?? [];
    const tagOptions = existingTags.map(t => `<option value="${t}">`).join('');

    const dialog = new Dialog({
      title: `Tag ${count} Contact${count !== 1 ? 's' : ''}`,
      content: `
        <form style="display:flex; flex-direction:column; gap:8px; padding:4px 0;">
          <label style="font-size:11px; font-weight:600;">Tag name</label>
          <input type="text" name="tag" list="ncm-tag-suggest" placeholder="e.g. HEIST, WATSON, VIP..."
                 style="padding:6px 8px; font-size:12px;">
          <datalist id="ncm-tag-suggest">${tagOptions}</datalist>
          <p style="font-size:10px; color:#888; margin:0;">Will be added to all ${count} selected contacts.</p>
        </form>`,
      buttons: {
        apply: {
          icon: '<i class="fas fa-tag"></i>',
          label: 'Apply Tag',
          callback: async (html) => {
            const tag = html.find('[name="tag"]').val()?.trim();
            if (!tag) return;
            let tagged = 0;
            for (const contactId of this._selectedContacts) {
              if (contactId.startsWith('pc-')) continue;
              const contact = this.masterContactService?.getContact(contactId);
              if (!contact) continue;
              const currentTags = contact.tags || [];
              if (!currentTags.includes(tag)) {
                await this.masterContactService.updateContact(contactId, {
                  tags: [...currentTags, tag],
                });
                tagged++;
              }
            }
            this._selectedContacts.clear();
            ui.notifications.info(`NCM | Tagged ${tagged} contact${tagged !== 1 ? 's' : ''} with "${tag}".`);
            this.render(true);
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
      },
      default: 'apply',
    });
    dialog.render(true);
  }

  /**
   * Shared dialog: pick player actors to share contacts with.
   * @param {string[]} contactIds - Array of contact IDs to share
   * @private
   */
  static async _showShareDialog(contactIds) {
    if (!contactIds.length) return;

    // Gather player-owned actors
    const playerActors = [];
    for (const user of game.users) {
      if (user.isGM || !user.character) continue;
      playerActors.push({
        actorId: user.character.id,
        actorName: user.character.name,
        playerName: user.name,
      });
    }

    if (!playerActors.length) {
      ui.notifications.warn('NCM | No player-owned characters found.');
      return;
    }

    // Build contact names for display
    const contactNames = contactIds
      .map(id => {
        if (id.startsWith('pc-')) return null;
        return this.masterContactService?.getContact(id)?.name;
      })
      .filter(Boolean);

    const isSingle = contactNames.length === 1;
    const title = isSingle ? `Share ${contactNames[0]}` : `Share ${contactNames.length} Contacts`;
    const desc = isSingle
      ? `Share <b>${contactNames[0]}</b> with:`
      : `Share <b>${contactNames.length}</b> contacts with:`;

    const checkboxes = playerActors.map(pa =>
      `<label style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:12px; cursor:pointer;">
        <input type="checkbox" name="actor-${pa.actorId}" value="${pa.actorId}" checked style="margin:0;">
        <b>${pa.actorName}</b> <span style="color:#888;">(${pa.playerName})</span>
      </label>`
    ).join('');

    const dialog = new Dialog({
      title,
      content: `
        <div style="display:flex; flex-direction:column; gap:8px; padding:4px 0;">
          <p style="font-size:11px; margin:0;">${desc}</p>
          <div style="display:flex; flex-direction:column; gap:2px;">${checkboxes}</div>
        </div>`,
      buttons: {
        share: {
          icon: '<i class="fas fa-share-nodes"></i>',
          label: 'Share',
          callback: async (html) => {
            const selectedActorIds = [];
            html.find('input[type="checkbox"]:checked').each((_, el) => {
              selectedActorIds.push(el.value);
            });
            if (!selectedActorIds.length) return;

            let shared = 0;
            for (const contactId of contactIds) {
              if (contactId.startsWith('pc-')) continue;
              for (const actorId of selectedActorIds) {
                const result = await this.masterContactService?.pushToPlayer(contactId, actorId);
                if (result?.success) shared++;
              }
            }

            const actorCount = selectedActorIds.length;
            ui.notifications.info(
              `NCM | Shared ${contactNames.length} contact${contactNames.length !== 1 ? 's' : ''} with ${actorCount} player${actorCount !== 1 ? 's' : ''}.`
            );
            this._selectedContacts.clear();
            this.render(true);
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
      },
      default: 'share',
    });
    dialog.render(true);
  }

  /**
   * Batch: burn selected contacts.
   */
  static async _onBatchBurnContacts() {
    if (!this._selectedContacts.size) return;
    const count = this._selectedContacts.size;
    const confirm = await Dialog.confirm({
      title: 'Burn Contacts',
      content: `<p>Mark <b>${count}</b> selected contacts as burned?</p>`,
    });
    if (!confirm) return;

    for (const contactId of this._selectedContacts) {
      if (contactId.startsWith('pc-')) continue; // Can't burn player characters
      await this.masterContactService?.updateContact(contactId, { burned: true });
    }
    this._selectedContacts.clear();
    ui.notifications.info(`NCM | ${count} contacts burned.`);
    this.render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Networks
  // ═══════════════════════════════════════════════════════════

  static async _onToggleNetwork(event, target) {
    event.preventDefault();
    event.stopPropagation();

    const networkId = target.closest('[data-network-id]')?.dataset.networkId
                   || target.dataset.networkId;
    if (!networkId) return;

    // Check if this is a global network
    const network = this.networkService?.getNetwork(networkId);
    if (network?.availability?.global) {
      ui.notifications.info(
        `NCM | "${network.name}" is globally available. ` +
        `Use the Network Manager to change its availability scope.`
      );
      return;
    }

    const scene = canvas.scene;
    if (!scene) {
      ui.notifications.warn('NCM | No active scene to modify network availability.');
      return;
    }

    const current = scene.getFlag(MODULE_ID, 'networkAvailability') ?? {};
    const updated = { ...current, [networkId]: !current[networkId] };

    await scene.setFlag(MODULE_ID, 'networkAvailability', updated);
    ui.notifications.info(
      `NCM | ${network?.name || networkId} ${updated[networkId] ? 'enabled' : 'disabled'} on ${scene.name}.`
    );
    this.render(true);
  }

  static _onOpenNetworkManager(event, target) {
    game.nightcity?.openNetworkManager?.();
    log.info('Admin: Opening Network Manager');
  }

  /**
   * Open the Network Manager with a specific network selected.
   * Uses polling to wait for the window to finish rendering,
   * since openNetworkManager's render(true) is async.
   */
  static _onEditNetworkInManager(event, target) {
    const networkId = target.dataset.networkId || target.closest('[data-network-id]')?.dataset.networkId;
    if (!networkId) {
      game.nightcity?.openNetworkManager?.();
      return;
    }

    game.nightcity?.openNetworkManagerToNetwork?.(networkId);
    log.info(`Admin: Opening Network Manager → ${networkId}`);
  }

  static _onOpenNetworkManagerLogs(event, target) {
    game.nightcity?.openNetworkManagerToLogs?.();
    log.info('Admin: Opening Network Manager → Logs tab');
  }

  static _onToggleNetworkGroup(event, target) {
    const groupKey = target.dataset.groupKey || target.closest('[data-group-key]')?.dataset.groupKey;
    if (!groupKey) return;
    if (this._collapsedNetGroups.has(groupKey)) {
      this._collapsedNetGroups.delete(groupKey);
    } else {
      this._collapsedNetGroups.add(groupKey);
    }
    this.render(true);
  }

  // ── Sprint 6: Scene Dead Zone Toggle ──

  static async _onToggleSceneDeadZone(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const chip = target.closest('[data-scene-id]');
    const sceneId = chip?.dataset.sceneId;
    if (!sceneId) return;
    const scene = game.scenes.get(sceneId);
    if (!scene) return;
    const currentDead = scene.getFlag(MODULE_ID, 'deadZone') ?? false;
    await this.networkService?.toggleDeadZone(sceneId, !currentDead);
    this.render(true);
  }

  // ── Sprint 6: Network Sub-View Toggle ──

  static _onSwitchNetworkSubView(event, target) {
    const subview = target.dataset.subview || target.closest('[data-subview]')?.dataset.subview;
    if (!subview) return;
    this._networkSubView = subview;
    this.render(true);
  }

  // ── Sprint 6: Card Log Toggle ──

  static _onToggleCardLog(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const networkId = target.dataset.networkId || target.closest('[data-network-id]')?.dataset.networkId;
    if (!networkId) return;
    if (this._expandedLogs.has(networkId)) {
      this._expandedLogs.delete(networkId);
    } else {
      this._expandedLogs.add(networkId);
    }
    this.render(true);
  }

  // ── Sprint 6: Log Entry Actions ──

  static _onDeleteLogEntry(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const entryId = target.dataset.entryId || target.closest('[data-entry-id]')?.dataset.entryId;
    if (!entryId) return;
    if (this.accessLogService?.deleteEntry(entryId)) {
      ui.notifications.info('NCM | Log entry deleted.');
      this.render(true);
    }
  }

  static _onEditLogEntry(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const entryId = target.dataset.entryId || target.closest('[data-entry-id]')?.dataset.entryId;
    if (!entryId) return;

    // Simple dialog for editing the message
    const entries = this.accessLogService?._entries ?? [];
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;

    const dialog = new Dialog({
      title: 'Edit Log Entry',
      content: `
        <form style="display:flex; flex-direction:column; gap:8px;">
          <label style="font-size:11px; font-weight:600;">Message</label>
          <input type="text" name="message" value="${entry.message ?? ''}" style="padding:4px 8px;">
          <label style="font-size:11px; font-weight:600;">Actor Name</label>
          <input type="text" name="actorName" value="${entry.actorName ?? ''}" style="padding:4px 8px;">
        </form>`,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: 'Save',
          callback: (html) => {
            const message = html.find('[name="message"]').val();
            const actorName = html.find('[name="actorName"]').val();
            this.accessLogService?.updateEntry(entryId, { message, actorName });
            this.render(true);
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
      },
      default: 'save',
    });
    dialog.render(true);
  }

  // ── Sprint 6: Full Log Panel Actions ──

  static _onFilterLogType(event, target) {
    const filter = target.dataset.filter || target.closest('[data-filter]')?.dataset.filter;
    if (!filter) return;
    this._logTypeFilter = filter;
    this.render(true);
  }

  static _onToggleAddLogForm() {
    this._showAddLogForm = !this._showAddLogForm;
    this.render(true);
  }

  static _onAddManualLogEntry(event, target) {
    event.preventDefault();
    const form = target.closest('.ncm-add-log-form') || this.element?.querySelector('.ncm-add-log-form');
    if (!form) return;

    const networkId = form.querySelector('[name="logNetwork"]')?.value;
    const actorName = form.querySelector('[name="logActor"]')?.value?.trim();
    const type = form.querySelector('[name="logType"]')?.value;
    const message = form.querySelector('[name="logMessage"]')?.value?.trim();

    if (!message) {
      ui.notifications.warn('NCM | Log message cannot be empty.');
      return;
    }

    const network = this.networkService?.getNetwork(networkId);
    this.accessLogService?.addManualEntry({
      networkId: networkId || 'unknown',
      networkName: network?.name ?? networkId,
      actorName: actorName || 'Unknown',
      type: type || 'manual',
      message,
    });

    // Clear form inputs
    const actorInput = form.querySelector('[name="logActor"]');
    const messageInput = form.querySelector('[name="logMessage"]');
    if (actorInput) actorInput.value = '';
    if (messageInput) messageInput.value = '';

    ui.notifications.info('NCM | Manual log entry added.');
    this.render(true);
  }

  static _onExportNetworkLogs() {
    const json = this.accessLogService?.exportLog();
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-network-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info('NCM | Network log exported as JSON.');
  }

  static _onExportFormattedNetworkLogs() {
    const text = this.accessLogService?.exportFormatted();
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-network-log-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info('NCM | Network log exported as text.');
  }

  static _onImportNetworkLogs() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const result = this.accessLogService?.importLog(text);
        if (result?.success) {
          ui.notifications.info(`NCM | Imported ${result.imported} log entries.`);
          this.render(true);
        } else {
          ui.notifications.error(`NCM | Import failed: ${result?.error ?? 'Unknown error'}`);
        }
      } catch (err) {
        ui.notifications.error(`NCM | Import failed: ${err.message}`);
      }
    });
    input.click();
  }

  static _onClearNetworkLogs() {
    Dialog.confirm({
      title: 'Clear Network Logs',
      content: '<p>Clear all network access log entries? This cannot be undone.</p>',
      yes: () => {
        this.accessLogService?.clearLog();
        ui.notifications.info('NCM | Network log cleared.');
        this.render(true);
      },
    });
  }

  static _onResetNetworkAuth(event, target) {
    const networkId = target.dataset.networkId || target.closest('[data-network-id]')?.dataset.networkId;
    if (!networkId) return;
    this.networkService?.revokeAuth(networkId);
    ui.notifications.info(`NCM | Auth reset for ${networkId}.`);
    this.render(true);
  }

  // ── Sprint 6: Network Broadcast ──

  static async _onSendBroadcast(event, target) {
    event.preventDefault();
    const bar = target.closest('.ncm-net-broadcast') || target.closest('.ncm-broadcast-bar') || this.element?.querySelector('.ncm-net-broadcast');
    if (!bar) return;

    const networkSelect = bar.querySelector('[name="broadcastNetwork"]');
    const messageInput = bar.querySelector('[name="broadcastMessage"]');
    const networkValue = networkSelect?.value ?? 'all';
    const message = messageInput?.value?.trim();

    if (!message) {
      ui.notifications.warn('NCM | Broadcast message cannot be empty.');
      return;
    }

    const networkName = networkValue === 'all'
      ? 'ALL NETWORKS'
      : (this.networkService?.getNetwork(networkValue)?.name ?? networkValue);

    // Create styled chat card whispered to all active non-GM users
    const whisperTargets = game.users.filter(u => u.active && !u.isGM).map(u => u.id);

    const content = `
      <div class="ncm-chat-card ncm-chat-card--broadcast">
        <div class="ncm-chat-card__header">
          <i class="fas fa-tower-broadcast"></i>
          <span class="ncm-chat-card__badge">NETWORK BROADCAST</span>
          <span class="ncm-chat-card__shared-by">${networkName}</span>
        </div>
        <div class="ncm-chat-card__content">
          <div class="ncm-chat-card__body">${foundry.utils.encodeHTML ? foundry.utils.encodeHTML(message) : message}</div>
        </div>
        <div class="ncm-chat-card__footer">
          <span class="ncm-chat-card__network ncm-mono">${networkName} // SYSTEM BROADCAST</span>
        </div>
      </div>`;

    await ChatMessage.create({
      content,
      whisper: whisperTargets,
      speaker: { alias: `NCM // ${networkName}` },
    });

    // Also log to access log
    this.accessLogService?.addManualEntry({
      networkId: networkValue === 'all' ? 'all' : networkValue,
      networkName,
      actorName: 'SYSTEM',
      type: 'system',
      message: `Broadcast: ${message}`,
    });

    // Clear input
    if (messageInput) messageInput.value = '';
    ui.notifications.info(`NCM | Broadcast sent to ${networkName}.`);
  }

  static _onScrollMixerLeft(event, target) {
    const strip = this.element?.querySelector('.ncm-mixer-strip');
    if (strip) strip.scrollBy({ left: -200, behavior: 'smooth' });
  }

  static _onScrollMixerRight(event, target) {
    const strip = this.element?.querySelector('.ncm-mixer-strip');
    if (strip) strip.scrollBy({ left: 200, behavior: 'smooth' });
  }

  static _onCycleNetAuthFilter() {
    const order = ['all', 'open', 'password', 'skill', 'locked', 'blocked'];
    const idx = order.indexOf(this._netAuthFilter);
    this._netAuthFilter = order[(idx + 1) % order.length];
    this.render();
  }

  static _onCycleNetStatusFilter() {
    const order = ['all', 'active', 'disabled'];
    const idx = order.indexOf(this._netStatusFilter);
    this._netStatusFilter = order[(idx + 1) % order.length];
    this.render();
  }

  static _onCycleNetGroupFilter() {
    const order = ['all', 'core', 'custom'];
    const idx = order.indexOf(this._netGroupFilter);
    this._netGroupFilter = order[(idx + 1) % order.length];
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Data Shards
  // ═══════════════════════════════════════════════════════════

  static _onOpenShardItem(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;

    const item = AdminPanelApp._findItem(itemId);
    if (!item) return;

    item.sheet.render(true);
    log.info(`Admin: Opening shard ${item.name}`);
  }

  static async _onForceDecrypt(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;

    const item = AdminPanelApp._findItem(itemId);
    if (!item) return;

    const confirmed = await Dialog.confirm({
      title: 'Force Decrypt',
      content: `<p>Force-decrypt <strong>${item.name}</strong>? This bypasses all security.</p>`,
    });
    if (!confirmed) return;

    await item.update({
      [`flags.${MODULE_ID}.state.decrypted`]: true,
    });

    ui.notifications.info(`Force-decrypted: ${item.name}`);
    this.render(true);
  }

  static async _onRelockShard(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;

    const item = AdminPanelApp._findItem(itemId);
    if (!item) return;

    const confirmed = await Dialog.confirm({
      title: 'Relock Shard',
      content: `<p>Relock <strong>${item.name}</strong>? All security state will be fully reset (encryption, login, key item, hack attempts, lockout, boot, expiration).</p>`,
    });
    if (!confirmed) return;

    const result = await game.nightcity?.dataShardService?.relockShard(item);
    if (result?.success) {
      ui.notifications.info(`Relocked: ${item.name}`);
    } else {
      ui.notifications.error(`Relock failed: ${result?.error || 'Unknown'}`);
    }
    this.render(true);
  }

  static async _onConvertItem(event, target) {
    // Open item picker or dialog to select an item to convert
    // For now, use Foundry's built-in document browser
    ui.notifications.info('Select an item from your Items tab, right-click → "Convert to Data Shard".');
  }

  static async _onQuickCreateShard(event, target) {
    const presetKey = target.closest('[data-preset]')?.dataset.preset;
    if (!presetKey) return;

    // Prompt GM to select an item
    const items = game.items?.filter(i => !i.getFlag(MODULE_ID, 'isDataShard')) ?? [];
    if (!items.length) {
      ui.notifications.warn('NCM | No unconverted items available. Create an item first.');
      return;
    }

    const options = items.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
    const itemId = await new Promise(resolve => {
      new Dialog({
        title: 'Quick Create Shard',
        content: `<p>Select an item to convert with the <strong>${presetKey}</strong> preset:</p>
          <div class="form-group"><select id="ncm-qc-item">${options}</select></div>`,
        buttons: {
          create: { label: 'Create', callback: html => resolve(html.find('#ncm-qc-item').val()) },
          cancel: { label: 'Cancel', callback: () => resolve(null) },
        },
        default: 'create',
      }).render(true);
    });

    if (!itemId) return;
    const item = game.items.get(itemId);
    if (!item) return;

    const result = await this.dataShardService?.convertToDataShard(item, {}, presetKey);
    if (result?.success) {
      ui.notifications.info(`NCM | Created "${item.name}" with ${presetKey} preset.`);
      this.render();
    } else {
      ui.notifications.error(`NCM | Failed: ${result?.error || 'Unknown error'}`);
    }
  }

  static async _onBulkRelockAll(event, target) {
    const shards = AdminPanelApp._getAllDataShards().filter(i => {
      const state = i.getFlag(MODULE_ID, 'state') ?? {};
      return state.decrypted === true;
    });

    if (!shards.length) {
      ui.notifications.info('NCM | No breached shards to relock.');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: 'Bulk Relock All Shards',
      content: `<p>Relock <strong>${shards.length}</strong> breached shard${shards.length > 1 ? 's' : ''}? All session data will be reset.</p>`,
    });
    if (!confirmed) return;

    for (const item of shards) {
      await this.dataShardService?.relockShard(item);
    }
    ui.notifications.info(`NCM | ${shards.length} shard${shards.length > 1 ? 's' : ''} relocked.`);
    this.render();
  }

  static async _onPurgeDestroyed(event, target) {
    const destroyed = AdminPanelApp._getAllDataShards().filter(i => {
      const state = i.getFlag(MODULE_ID, 'state') ?? {};
      return state.destroyed === true;
    });

    if (!destroyed.length) {
      ui.notifications.info('NCM | No destroyed shards to purge.');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: 'Purge Destroyed Shards',
      content: `<p>Remove shard flags from <strong>${destroyed.length}</strong> destroyed shard${destroyed.length > 1 ? 's' : ''}? The items will remain but lose their shard data.</p>`,
    });
    if (!confirmed) return;

    for (const item of destroyed) {
      await this.dataShardService?.removeDataShard(item, true);
    }
    ui.notifications.info(`NCM | ${destroyed.length} destroyed shard${destroyed.length > 1 ? 's' : ''} purged.`);
    this.render();
  }

  static _onConfigureShardItem(event, target) {
    event.stopPropagation(); // Don't trigger card click (openShardItem)
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    const item = AdminPanelApp._findItem(itemId);
    if (!item) return;

    import('../ItemInbox/ItemInboxConfig.js').then(({ ItemInboxConfig }) => {
      new ItemInboxConfig({ item }).render(true);
    });
  }

  static async _onRelockShardItem(event, target) {
    event.stopPropagation(); // Don't trigger card click (openShardItem)
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    const item = AdminPanelApp._findItem(itemId);
    if (!item) return;

    const result = await game.nightcity?.dataShardService?.relockShard(item);
    if (result?.success) {
      ui.notifications.info(`NCM | Relocked: ${item.name}`);
      this.render();
    }
  }

  // ─── v4 Shard Tab Handlers ───

  static _onToggleShardGroup(event, target) {
    const key = target.closest('[data-group-key]')?.dataset.groupKey;
    if (!key) return;
    if (this._collapsedShardGroups.has(key)) {
      this._collapsedShardGroups.delete(key);
    } else {
      this._collapsedShardGroups.add(key);
    }
    this.render();
  }

  static _onToggleShardSelectMode(event, target) {
    this._shardSelectMode = !this._shardSelectMode;
    if (!this._shardSelectMode) this._selectedShardIds.clear();
    this.render();
  }

  static _onToggleShardSelect(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    if (this._selectedShardIds.has(itemId)) {
      this._selectedShardIds.delete(itemId);
    } else {
      this._selectedShardIds.add(itemId);
    }
    this.render();
  }

  static _onDeselectAllShards(event, target) {
    this._selectedShardIds.clear();
    this.render();
  }

  static _onExpandShard(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    this._expandedShardId = this._expandedShardId === itemId ? null : itemId;
    this.render();
  }

  static async _onBulkRelockSelected(event, target) {
    const ids = [...this._selectedShardIds];
    if (!ids.length) return;

    const confirmed = await Dialog.confirm({
      title: 'Relock Selected Shards',
      content: `<p>Relock <strong>${ids.length}</strong> selected shard${ids.length > 1 ? 's' : ''}? All session data will be reset.</p>`,
    });
    if (!confirmed) return;

    for (const id of ids) {
      const item = AdminPanelApp._findItem(id);
      if (item) await this.dataShardService?.relockShard(item);
    }
    this._selectedShardIds.clear();
    ui.notifications.info(`NCM | ${ids.length} shard${ids.length > 1 ? 's' : ''} relocked.`);
    this.render();
  }

  static _onBulkExportSelected(event, target) {
    const ids = [...this._selectedShardIds];
    if (!ids.length) return;

    const exportData = [];
    for (const id of ids) {
      const item = AdminPanelApp._findItem(id);
      if (!item) continue;
      const config = item.getFlag(MODULE_ID, 'config');
      const state = item.getFlag(MODULE_ID, 'state');
      exportData.push({ name: item.name, id: item.id, config, state });
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-shards-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info(`NCM | Exported ${exportData.length} shard${exportData.length > 1 ? 's' : ''}.`);
  }

  static async _onUnconvertShard(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;

    const item = AdminPanelApp._findItem(itemId);
    if (!item) return;

    const confirmed = await Dialog.confirm({
      title: 'Unconvert Data Shard',
      content: `<p>Remove all data shard flags from <strong>${item.name}</strong>? The item will revert to a normal item. Shard entries and journal data will be preserved but detached.</p>`,
    });
    if (!confirmed) return;

    await item.unsetFlag(MODULE_ID, 'isDataShard');
    await item.unsetFlag(MODULE_ID, 'config');
    await item.unsetFlag(MODULE_ID, 'state');
    // Keep journalId so data isn't lost, just detached

    ui.notifications.info(`NCM | Unconverted: ${item.name} is now a regular item.`);
    this.render();
  }

  static _onCycleShardSort(event, target) {
    const sortOrder = ['name', 'status', 'accessed'];
    const idx = sortOrder.indexOf(this._shardSort);
    this._shardSort = sortOrder[(idx + 1) % sortOrder.length];
    this.render();
  }

  static _onCycleShardIceFilter(event, target) {
    const order = ['all', 'ice', 'black', 'red', 'decrypted', 'none'];
    const idx = order.indexOf(this._shardIceFilter);
    this._shardIceFilter = order[(idx + 1) % order.length];
    this.render();
  }

  static _onCycleShardStatusFilter(event, target) {
    const order = ['all', 'locked', 'breached', 'open', 'destroyed'];
    const idx = order.indexOf(this._shardStatusFilter);
    this._shardStatusFilter = order[(idx + 1) % order.length];
    this.render();
  }

  static _onCycleShardPresetFilter(event, target) {
    const presets = ['all', ...(game.nightcity?.dataShardService?.getAllPresets() ?? []).map(p => p.key)];
    const idx = presets.indexOf(this._shardPresetFilter);
    this._shardPresetFilter = presets[(idx + 1) % presets.length];
    this.render();
  }

  static _onCycleShardOwnerFilter(event, target) {
    const order = ['all', 'world', 'actors'];
    const idx = order.indexOf(this._shardOwnerFilter);
    this._shardOwnerFilter = order[(idx + 1) % order.length];
    this.render();
  }

  static _onCycleShardGroupMode(event, target) {
    const order = ['owner', 'preset', 'status', 'none'];
    const idx = order.indexOf(this._shardGroupMode);
    this._shardGroupMode = order[(idx + 1) % order.length];
    this.render();
  }

  static async _onToggleShardLayer(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    const layer = target.closest('[data-layer]')?.dataset.layer;
    if (!itemId || !layer) return;

    const item = AdminPanelApp._findItem(itemId);
    if (!item) return;

    const state = item.getFlag(MODULE_ID, 'state') ?? {};
    const sessions = state.sessions ?? {};

    // Determine current cleared state for this layer
    let isCleared = false;
    switch (layer) {
      case 'network':
        isCleared = !!Object.values(sessions).find(s => s.hackedLayers?.includes('network'));
        break;
      case 'keyitem':
        isCleared = !!Object.values(sessions).find(s => s.keyItemUsed);
        break;
      case 'login':
        isCleared = !!Object.values(sessions).find(s => s.loggedIn);
        break;
      case 'encryption':
        isCleared = state.decrypted ?? false;
        break;
    }

    const action = isCleared ? 'relock to' : 'unlock to';
    const confirmed = await Dialog.confirm({
      title: `${isCleared ? 'Relock' : 'Unlock'} Security Layer`,
      content: `<p>${isCleared ? 'Relock' : 'Force-clear'} the <strong>${layer}</strong> layer on <strong>${item.name}</strong>?${isCleared ? ' All layers from this point forward will also be relocked.' : ''}</p>`,
    });
    if (!confirmed) return;

    const LAYER_ORDER = ['network', 'keyitem', 'login', 'encryption'];
    const layerIdx = LAYER_ORDER.indexOf(layer);

    if (isCleared) {
      // RELOCK from this layer forward — reset all sessions for layers at and after this index
      const updates = {};
      for (const [actorId, session] of Object.entries(sessions)) {
        const newSession = { ...session };
        const hackedLayers = [...(session.hackedLayers || [])];

        for (let i = layerIdx; i < LAYER_ORDER.length; i++) {
          const l = LAYER_ORDER[i];
          const hIdx = hackedLayers.indexOf(l);
          if (hIdx !== -1) hackedLayers.splice(hIdx, 1);
          if (l === 'keyitem') newSession.keyItemUsed = false;
          if (l === 'login') newSession.loggedIn = false;
        }
        newSession.hackedLayers = hackedLayers;
        updates[actorId] = newSession;
      }

      const stateUpdates = { [`flags.${MODULE_ID}.state.sessions`]: updates };
      // If encryption is at or after this layer, also un-decrypt
      if (layerIdx <= LAYER_ORDER.indexOf('encryption')) {
        stateUpdates[`flags.${MODULE_ID}.state.decrypted`] = false;
        stateUpdates[`flags.${MODULE_ID}.state.gmBypassed`] = false;
      }
      await item.update(stateUpdates);
      ui.notifications.info(`NCM | Relocked ${item.name} from ${layer} layer.`);
    } else {
      // UNLOCK up to and including this layer
      const updates = {};
      // If no sessions exist, create a GM session
      const gmSession = sessions['gm-override'] || { hackedLayers: [], hackAttempts: 0 };
      const hackedLayers = [...(gmSession.hackedLayers || [])];

      for (let i = 0; i <= layerIdx; i++) {
        const l = LAYER_ORDER[i];
        if (!hackedLayers.includes(l)) hackedLayers.push(l);
        if (l === 'keyitem') gmSession.keyItemUsed = true;
        if (l === 'login') gmSession.loggedIn = true;
      }
      gmSession.hackedLayers = hackedLayers;
      updates['gm-override'] = gmSession;
      // Merge with existing sessions
      const mergedSessions = { ...sessions, ...updates };

      const stateUpdates = { [`flags.${MODULE_ID}.state.sessions`]: mergedSessions };
      if (layer === 'encryption') {
        stateUpdates[`flags.${MODULE_ID}.state.decrypted`] = true;
        stateUpdates[`flags.${MODULE_ID}.state.gmBypassed`] = true;
      }
      await item.update(stateUpdates);
      ui.notifications.info(`NCM | Force-cleared ${item.name} through ${layer} layer.`);
    }
    this.render();
  }

  static async _onForceDecryptShardItem(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    const item = AdminPanelApp._findItem(itemId);
    if (!item) return;

    const state = item.getFlag(MODULE_ID, 'state') ?? {};
    if (state.decrypted) {
      // Already decrypted → relock
      const result = await game.nightcity?.dataShardService?.relockShard(item);
      if (result?.success) {
        ui.notifications.info(`NCM | Relocked: ${item.name}`);
      }
    } else {
      // Locked → force decrypt
      await item.update({ [`flags.${MODULE_ID}.state.decrypted`]: true, [`flags.${MODULE_ID}.state.gmBypassed`]: true });
      ui.notifications.info(`NCM | Force-decrypted: ${item.name}`);
    }
    this.render();
  }

  // ─── Shard Activity Log Helper ───

  /**
   * Add an entry to the in-memory shard activity log.
   * @param {string} type - 'success' | 'fail' | 'gm'
   * @param {string} icon - FontAwesome icon name (without 'fa-')
   * @param {object} data - Event data with itemId, actorId
   * @param {string} text - Description text
   * @private
   */
  _logShardActivity(type, icon, data, text) {
    const actor = data.actorId ? game.actors?.get(data.actorId) : null;
    const item = data.itemId ? game.items?.get(data.itemId) : null;
    const actorName = actor?.name || (data.actorId === 'gm-override' ? 'GM' : 'Unknown');
    const shardName = item?.name || 'Unknown Shard';

    this._shardActivityLog.unshift({
      type,
      icon,
      text: `<span class="ncm-activity-actor">${actorName}</span> ${text} — <span class="ncm-activity-shard">${shardName}</span>`,
      time: this._getRelativeTime(Date.now()),
      timestamp: Date.now(),
    });

    // Keep max 20 entries
    if (this._shardActivityLog.length > 20) this._shardActivityLog.length = 20;
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Tools
  // ═══════════════════════════════════════════════════════════

  static _onOpenThemeCustomizer(event, target) {
    game.nightcity?.openThemeCustomizer?.();
    log.info('Admin: Opening Theme Customizer');
  }

  static async _onForceRefreshAll(event, target) {
    ui.notifications.info('Force-refreshing all connected clients...');
    game.socket?.emit(`module.${MODULE_ID}`, {
      type: 'forceRefresh',
    });
    // Also refresh local
    this.render(true);
  }

  static _onRefreshStats(event, target) {
    this.render(true);
  }

  static async _onExportLogs(event, target) {
    try {
      const messages = [];
      for (const actor of game.actors) {
        const actorMsgs = await game.nightcity?.messageService?.getMessages(actor.id) ?? [];
        messages.push(...actorMsgs.map(m => ({ actor: actor.name, ...m })));
      }

      const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ncm-messages-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);

      ui.notifications.info(`Exported ${messages.length} messages.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Export failed:`, error);
      ui.notifications.error('Export failed. Check console.');
    }
  }

  static async _onHealthCheck(event, target) {
    const checks = [];
    checks.push(`MessageService: ${game.nightcity?.messageService ? '✓' : '✗'}`);
    checks.push(`NetworkService: ${game.nightcity?.networkService ? '✓' : '✗'}`);
    checks.push(`DataShardService: ${game.nightcity?.dataShardService ? '✓' : '✗'}`);
    checks.push(`MasterContactService: ${game.nightcity?.masterContactService ? '✓' : '✗'}`);
    checks.push(`SchedulingService: ${game.nightcity?.schedulingService ? '✓' : '✗'}`);
    checks.push(`ThemeService: ${game.nightcity?.themeService ? '✓' : '✗'}`);
    checks.push(`SoundService: ${game.nightcity?.soundService ? '✓' : '✗'}`);

    const allOk = checks.every(c => c.includes('✓'));

    await Dialog.prompt({
      title: 'NCM Health Check',
      content: `<div style="font-family: monospace; font-size: 12px; line-height: 1.6;">
        <p>${checks.join('<br>')}</p>
        <p style="margin-top: 8px; color: ${allOk ? '#00ff41' : '#ff0033'};">
          ${allOk ? '● ALL SYSTEMS NOMINAL' : '● SYSTEM DEGRADED — Check console'}
        </p>
      </div>`,
      callback: () => {},
    });
  }

  static _onOpenTimeSettings(event, target) {
    // Open SimpleCalendar settings if available
    if (game.modules.get('foundryvtt-simple-calendar')?.active) {
      SimpleCalendar?.api?.showCalendar();
    } else {
      ui.notifications.warn('SimpleCalendar module is not active.');
    }
  }

  static _onOpenSoundSettings(event, target) {
    // Open sound configuration dialog
    ui.notifications.info('Sound settings — coming in a future update.');
  }

  // ─── Danger Zone ───

  static async _onPurgeMessages(event, target) {
    const confirmed = await Dialog.confirm({
      title: '⚠ Purge Messages',
      content: '<p>Select an actor and delete ALL their messages? This cannot be undone.</p>',
    });
    if (!confirmed) return;

    // TODO: Show actor picker, then purge
    ui.notifications.info('Purge feature requires actor selection dialog.');
  }

  static async _onResetModule(event, target) {
    const confirmed = await Dialog.confirm({
      title: '⚠ RESET MODULE',
      content: '<p style="color: #ff0033;"><strong>This will permanently delete ALL Night City Messenger data.</strong></p><p>All messages, contacts, shards, and settings will be lost. This cannot be undone.</p>',
    });
    if (!confirmed) return;

    // Double-confirm
    const reallyConfirmed = await Dialog.confirm({
      title: '⚠ ARE YOU ABSOLUTELY SURE?',
      content: '<p>Type RESET to confirm — all data will be destroyed.</p>',
    });
    if (!reallyConfirmed) return;

    ui.notifications.warn('Module reset not yet implemented — safety measure.');
  }

  static async _onRebuildIndex(event, target) {
    ui.notifications.info('Rebuilding journal and contact indices...');
    try {
      await game.nightcity?.messageRepository?.rebuildIndex?.();
      await game.nightcity?.contactRepository?.rebuildIndex?.();
      ui.notifications.info('Index rebuild complete.');
      this.render(true);
    } catch (error) {
      console.error(`${MODULE_ID} | Rebuild failed:`, error);
      ui.notifications.error('Rebuild failed. Check console.');
    }
  }

  // ─── Legacy Handlers ───

  static _onToggleCompactMode(event, target) {
    this._compactMode = !this._compactMode;
    this.render(true);
  }

  static async _onHardDeleteMessage(event, target) {
    const messageId = target.closest('[data-message-id]')?.dataset.messageId;
    if (!messageId) return;

    const confirmed = await Dialog.confirm({
      title: 'Hard Delete Message',
      content: '<p>Permanently delete this message? This cannot be undone.</p>',
    });
    if (!confirmed) return;

    await this.messageRepository?.hardDelete(messageId);
    ui.notifications.info('Message permanently deleted.');
    this.render(true);
  }
}
