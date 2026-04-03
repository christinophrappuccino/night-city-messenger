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
import { log, isGM, formatCyberDate } from '../../utils/helpers.js';
import { DateRangePicker } from '../components/DateRangePicker.js';
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
  /** @type {number} Feed list internal scroll position */
  _feedListScroll = 0;

  /**
   * Save all scroll positions before a render.
   * @private
   */
  _saveScroll() {
    const content = this.element?.querySelector('.ncm-admin-content');
    if (content) this._scrollPositions[this._activeTab] = content.scrollTop;
    const feedList = this.element?.querySelector('.ncm-msg-feed-list');
    if (feedList) this._feedListScroll = feedList.scrollTop;
  }

  // ── Overview tab state ──
  /** @type {Array<object>} Cross-domain activity log for this session */
  _overviewActivityLog = [];
  /** @type {Set<string>} Dismissed alert keys (session only) */
  _dismissedAlerts = new Set();

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

  // ── Messages tab state (v2) ──
  /** @type {string} Feed direction filter: 'all' | 'received' | 'sent' | 'unread' */
  _msgFeedFilter = 'all';
  /** @type {string} Feed search query */
  _msgFeedSearch = '';
  /** @type {string} Actor filter (actor ID or '' for all) */
  _msgFeedActorFilter = '';
  /** @type {string|null} Expanded message ID in the activity feed */
  _expandedMessageId = null;
  /** @type {boolean} Actor filter dropdown open state */
  _msgActorDropdownOpen = false;
  /** @type {string} Actor filter dropdown search */
  _msgActorDropdownSearch = '';
  /** @type {string} Date-from filter (YYYY-MM-DD or '') */
  _msgFeedDateFrom = '';
  /** @type {string} Date-to filter (YYYY-MM-DD or '') */
  _msgFeedDateTo = '';
  /** @type {number} How many feed entries to show (pagination) */
  _msgFeedLimit = 20;
  /** @type {string} NPC quick-send search query */
  _npcSendSearch = '';
  /** @type {number} Current NPC send-as page (0-indexed) */
  _npcSendPage = 0;
  /** @type {number} NPCs per page */
  _npcSendPerPage = 8;

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
      ovComposeAs: AdminPanelApp._onOvComposeAs,
      ovNewShard: AdminPanelApp._onOvNewShard,
      ovBroadcast: AdminPanelApp._onOvBroadcast,
      ovClearAlerts: AdminPanelApp._onOvClearAlerts,
      ovDismissAlert: AdminPanelApp._onOvDismissAlert,

      // Messages actions
      quickSend: AdminPanelApp._onQuickSend,
      openComposer: AdminPanelApp._onOpenComposer,
      cancelScheduled: AdminPanelApp._onCancelScheduled,
      editScheduled: AdminPanelApp._onEditScheduled,

      // Messages v2 actions
      msgFeedFilter: AdminPanelApp._onMsgFeedFilter,
      toggleMsgExpand: AdminPanelApp._onToggleMsgExpand,
      toggleMsgActorFilter: AdminPanelApp._onToggleMsgActorFilter,
      setMsgActorFilter: AdminPanelApp._onSetMsgActorFilter,
      openMsgInInbox: AdminPanelApp._onOpenMsgInInbox,
      replyAsMsg: AdminPanelApp._onReplyAsMsg,
      shareMsgToChat: AdminPanelApp._onShareMsgToChat,
      forceDeliverMsg: AdminPanelApp._onForceDeliverMsg,
      cancelQueuedMsg: AdminPanelApp._onCancelQueuedMsg,
      flushMsgQueue: AdminPanelApp._onFlushMsgQueue,
      markAllRead: AdminPanelApp._onMarkAllRead,
      purgeOldMessages: AdminPanelApp._onPurgeOldMessages,
      msgBroadcast: AdminPanelApp._onMsgBroadcast,
      loadMoreMessages: AdminPanelApp._onLoadMoreMessages,
      openDateRangePicker: AdminPanelApp._onOpenDateRangePicker,
      clearFeedDates: AdminPanelApp._onClearFeedDates,
      npcQuickSend: AdminPanelApp._onNpcQuickSend,
      npcPagePrev: AdminPanelApp._onNpcPagePrev,
      npcPageNext: AdminPanelApp._onNpcPageNext,
      openViewInboxDialog: AdminPanelApp._onOpenViewInboxDialog,

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
      openRecentMessage:   AdminPanelApp._onOpenRecentMessage,

      // Networks actions
      toggleNetwork: AdminPanelApp._onToggleNetwork,
      openNetworkManager: AdminPanelApp._onOpenNetworkManager,
      editNetworkInManager: AdminPanelApp._onEditNetworkInManager,
      toggleSceneDeadZone: AdminPanelApp._onToggleSceneDeadZone,
      switchNetworkSubView: AdminPanelApp._onSwitchNetworkSubView,
      toggleCardLog: AdminPanelApp._onToggleCardLog,
      deleteLogEntry: AdminPanelApp._onDeleteLogEntry,
      editLogEntry: AdminPanelApp._onEditLogEntry,
      openLogReference: AdminPanelApp._onOpenLogReference,
      filterLogType: AdminPanelApp._onFilterLogType,
      addManualLogEntry: AdminPanelApp._onAddManualLogEntry,
      toggleAddLogForm: AdminPanelApp._onToggleAddLogForm,
      exportNetworkLogs: AdminPanelApp._onExportNetworkLogs,
      exportFormattedNetworkLogs: AdminPanelApp._onExportFormattedNetworkLogs,
      importNetworkLogs: AdminPanelApp._onImportNetworkLogs,
      clearNetworkLogs: AdminPanelApp._onClearNetworkLogs,
      resetNetworkAuth: AdminPanelApp._onResetNetworkAuth,
      createNetwork: AdminPanelApp._onCreateNetwork,
      deleteNetwork: AdminPanelApp._onDeleteNetwork,
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
      setShardIntegrity: AdminPanelApp._onSetShardIntegrity,
      restoreShardIntegrity: AdminPanelApp._onRestoreShardIntegrity,

      // Tools actions
      openThemeCustomizer: AdminPanelApp._onOpenThemeCustomizer,
      forceRefreshAll: AdminPanelApp._onForceRefreshAll,
      refreshStats: AdminPanelApp._onRefreshStats,
      exportLogs: AdminPanelApp._onExportLogs,
      healthCheck: AdminPanelApp._onHealthCheck,
      openTimeSettings: AdminPanelApp._onOpenTimeSettings,
      openSoundSettings: AdminPanelApp._onOpenSoundSettings,
      manageDomains: AdminPanelApp._onManageDomains,
      reorganizeJournals: AdminPanelApp._onReorganizeJournals,

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
    const npcSendData = this._gatherNPCActors();

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
      { value: 'trace', label: 'Trace', active: this._logTypeFilter === 'trace' },
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
      overviewAlerts: this._gatherOverviewAlerts(stats, shards, scheduledEntries, sceneStrip),
      overviewActivity: this._overviewActivityLog.slice(0, 15),

      // Messages tab
      npcSendEntries: npcSendData.entries,
      npcSendTotalCount: npcSendData.totalCount,
      npcSendPage: npcSendData.page + 1,
      npcSendTotalPages: npcSendData.totalPages,
      npcSendHasPrev: npcSendData.hasPrev,
      npcSendHasNext: npcSendData.hasNext,
      npcSendSearch: npcSendData.search,
      playerActors,
      scheduledEntries,
      ...this._gatherMessagesTabContext(stats),

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
   * Generate attention-required alerts for the overview tab.
   * Checks: unread pileup per actor, destroyed shards, imminent scheduled
   * messages, and dead zones on the active scene.
   * @param {object} stats - Message stats from _gatherStats
   * @param {Array} shards - Shard data from _gatherShardData
   * @param {Array} scheduledEntries - Formatted scheduled entries
   * @param {Array} sceneStrip - Scene strip data
   * @returns {Array<object>}
   * @private
   */
  _gatherOverviewAlerts(stats, shards, scheduledEntries, sceneStrip) {
    const alerts = [];

    // ── Unread message pileup (>3 per actor) ──
    for (const actor of stats.actorStats) {
      if (actor.unreadMessages >= 3) {
        const key = `unread-${actor.actorId}`;
        if (this._dismissedAlerts.has(key)) continue;
        alerts.push({
          key,
          severity: 'urgent',
          iconClass: 'fas fa-envelope-circle-exclamation',
          text: `${actor.actorName} has ${actor.unreadMessages} unread messages piling up`,
          sub: null,
          domain: 'msg',
          domainLabel: 'MSG',
          actionLabel: 'Open Inbox',
          actionName: 'openInbox',
          actionActorId: actor.actorId,
        });
      }
    }

    // ── Destroyed / bricked shards ──
    for (const shard of shards) {
      if (shard.status === 'destroyed') {
        const key = `destroyed-${shard.itemId}`;
        if (this._dismissedAlerts.has(key)) continue;
        alerts.push({
          key,
          severity: 'urgent',
          iconClass: 'fas fa-skull-crossbones',
          text: `Shard "${shard.name}" integrity at 0% — destroyed`,
          sub: null,
          domain: 'shard',
          domainLabel: 'SHARD',
          actionLabel: 'View Shard',
          actionName: 'openShardItem',
          actionItemId: shard.itemId,
        });
      }
    }

    // ── Scheduled messages firing soon (<5 min) ──
    for (const entry of scheduledEntries) {
      if (entry.isSoon) {
        const key = `sched-${entry.id}`;
        if (this._dismissedAlerts.has(key)) continue;
        alerts.push({
          key,
          severity: 'warn',
          iconClass: 'fas fa-clock',
          text: `Scheduled message fires in ${entry.countdown}`,
          sub: `${entry.fromName} → ${entry.toName}: "${entry.subject}"`,
          domain: 'sched',
          domainLabel: 'SCHED',
          actionLabel: 'Edit',
          actionName: 'editScheduled',
          actionActorId: null,
        });
      }
    }

    // ── Dead zones on active scene ──
    const activeScene = game.scenes?.active;
    if (activeScene) {
      for (const scene of sceneStrip) {
        if (scene.deadZone && scene.sceneId === activeScene.id) {
          const key = `deadzone-${scene.sceneId}`;
          if (this._dismissedAlerts.has(key)) continue;
          alerts.push({
            key,
            severity: 'info',
            iconClass: 'fas fa-signal',
            text: `Dead zone active on current scene`,
            sub: `${scene.sceneName} — No signal, queued messages will hold`,
            domain: 'net',
            domainLabel: 'NET',
            actionLabel: 'Networks',
            actionName: 'switchTab',
            actionTab: 'networks',
          });
        }
      }
    }

    return alerts;
  }

  /**
   * Log an activity event to the overview feed.
   * Entries persist for the session only (not saved to flags).
   * @param {string} domain - 'msg' | 'shard' | 'net' | 'contact' | 'alert'
   * @param {string} icon - FontAwesome icon name (without 'fa-' prefix)
   * @param {string} html - HTML text for the feed entry (supports inline spans)
   * @param {object} [options] - Optional context
   * @param {string} [options.actorId] - Actor ID for click-through
   * @param {string} [options.itemId] - Item ID for click-through
   * @param {string} [options.detail] - Secondary detail text
   * @private
   */
  _logOverviewActivity(domain, icon, html, options = {}) {
    this._overviewActivityLog.unshift({
      domain,
      icon,
      html,
      time: this._getRelativeTime(Date.now()),
      timestamp: Date.now(),
      actorId: options.actorId || null,
      itemId: options.itemId || null,
    });

    // Cap at 30 entries
    if (this._overviewActivityLog.length > 30) this._overviewActivityLog.length = 30;
  }

  /**
   * Gather ALL NPCs for the quick-send grid — master contacts + NPC actors.
   * Includes search filtering and pagination.
   * @returns {object} { entries, totalCount, hasMore, search }
   * @private
   */
  _gatherNPCActors() {
    const roleColors = {
      fixer: '#d4a017', netrunner: '#00e5ff', runner: '#00e5ff',
      corp: '#4a8ab5', exec: '#6ec1e4', solo: '#e04848',
      tech: '#2ecc71', medtech: '#1abc9c', media: '#b87aff',
      nomad: '#d4844a', lawman: '#6b8fa3', rocker: '#e05cb5',
      ripperdoc: '#e06888', gang: '#cc4444', government: '#5a7fa5', ai: '#ff44cc',
    };

    const all = [];
    const seenIds = new Set();

    // ── Pass 1: Master contacts (non-player) ──
    const contacts = this.masterContactService?.getAll() ?? [];
    for (const c of contacts) {
      if (!c.email) continue;
      // Skip player-linked contacts
      if (c.actorId) {
        const actor = game.actors?.get(c.actorId);
        if (actor?.hasPlayerOwner) continue;
      }
      const primaryId = c.actorId || c.id;
      if (seenIds.has(primaryId)) continue;
      seenIds.add(primaryId);
      if (c.actorId) seenIds.add(c.actorId);
      seenIds.add(c.id);

      const roleLower = (c.role || '').toLowerCase();
      all.push({
        id: primaryId,
        contactId: c.id,
        name: c.name,
        email: c.email,
        initial: (c.name || '?').charAt(0).toUpperCase(),
        color: roleColors[roleLower] || '#F65261',
        portrait: c.portrait || null,
        role: c.role || '',
        isContact: true,
      });
    }

    // ── Pass 2: NPC actors with emails NOT already in master contacts ──
    for (const actor of game.actors ?? []) {
      if (actor.hasPlayerOwner) continue;
      if (seenIds.has(actor.id)) continue;
      const email = actor.getFlag(MODULE_ID, 'email');
      if (!email) continue;
      seenIds.add(actor.id);

      all.push({
        id: actor.id,
        contactId: null,
        name: actor.name,
        email,
        initial: (actor.name || '?').charAt(0).toUpperCase(),
        color: '#F65261',
        portrait: actor.img && !actor.img.includes('mystery-man') ? actor.img : null,
        role: '',
        isContact: false,
      });
    }

    // Sort alphabetically
    all.sort((a, b) => a.name.localeCompare(b.name));

    // Apply search
    let filtered = all;
    if (this._npcSendSearch) {
      const q = this._npcSendSearch.toLowerCase();
      filtered = filtered.filter(n =>
        n.name.toLowerCase().includes(q) ||
        n.email.toLowerCase().includes(q) ||
        n.role.toLowerCase().includes(q)
      );
    }

    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / this._npcSendPerPage));

    // Clamp page
    if (this._npcSendPage >= totalPages) this._npcSendPage = totalPages - 1;
    if (this._npcSendPage < 0) this._npcSendPage = 0;

    const startIdx = this._npcSendPage * this._npcSendPerPage;
    const entries = filtered.slice(startIdx, startIdx + this._npcSendPerPage);

    return {
      entries,
      totalCount,
      page: this._npcSendPage,
      totalPages,
      hasPrev: this._npcSendPage > 0,
      hasNext: this._npcSendPage < totalPages - 1,
      search: this._npcSendSearch,
    };
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
   * Gather all inboxes for the View Inbox dialog.
   * Includes player actors, NPC actors with emails, and master contacts.
   * @returns {Array<object>}
   * @private
   */
  _gatherInboxDropdownEntries() {
    const entries = [];
    const seenIds = new Set();

    // ── Players ──
    for (const user of game.users ?? []) {
      if (user.isGM || !user.character) continue;
      const actor = user.character;
      if (seenIds.has(actor.id)) continue;
      seenIds.add(actor.id);

      entries.push({
        inboxId: actor.id,
        name: actor.name,
        initial: (actor.name || '?').charAt(0).toUpperCase(),
        color: '#19f3f7',
        type: 'Player',
        typeIcon: 'fa-user',
        email: actor.getFlag?.(MODULE_ID, 'email') || '',
        isPlayer: true,
      });
    }

    // ── Master contacts ──
    const contacts = this.masterContactService?.getAll() ?? [];
    const roleColors = {
      fixer: '#d4a017', netrunner: '#00e5ff', runner: '#00e5ff',
      corp: '#4a8ab5', exec: '#6ec1e4', solo: '#e04848',
      tech: '#2ecc71', medtech: '#1abc9c', media: '#b87aff',
      nomad: '#d4844a', lawman: '#6b8fa3', rocker: '#e05cb5',
    };

    for (const c of contacts) {
      const primaryId = c.actorId || c.id;
      if (seenIds.has(primaryId)) continue;
      seenIds.add(primaryId);
      if (c.actorId) seenIds.add(c.actorId);
      seenIds.add(c.id);

      // Skip player-linked
      if (c.actorId) {
        const actor = game.actors?.get(c.actorId);
        if (actor?.hasPlayerOwner) continue;
      }

      const roleLower = (c.role || '').toLowerCase();
      entries.push({
        inboxId: primaryId,
        name: c.name,
        initial: (c.name || '?').charAt(0).toUpperCase(),
        color: roleColors[roleLower] || '#F65261',
        type: c.role ? c.role.charAt(0).toUpperCase() + c.role.slice(1) : 'NPC',
        typeIcon: 'fa-user-secret',
        email: c.email || '',
        isPlayer: false,
      });
    }

    // ── NPC actors with emails not in master contacts ──
    for (const actor of game.actors ?? []) {
      if (actor.hasPlayerOwner) continue;
      if (seenIds.has(actor.id)) continue;
      const email = actor.getFlag(MODULE_ID, 'email');
      if (!email) continue;
      seenIds.add(actor.id);

      entries.push({
        inboxId: actor.id,
        name: actor.name,
        initial: (actor.name || '?').charAt(0).toUpperCase(),
        color: '#F65261',
        type: 'NPC',
        typeIcon: 'fa-user-secret',
        email,
        isPlayer: false,
      });
    }

    // Sort: players first, then alphabetical
    entries.sort((a, b) => {
      if (a.isPlayer && !b.isPlayer) return -1;
      if (!a.isPlayer && b.isPlayer) return 1;
      return a.name.localeCompare(b.name);
    });

    return entries;
  }

  // ═══════════════════════════════════════════════════════════
  //  Messages Tab v2 — Data Gathering
  // ═══════════════════════════════════════════════════════════

  /**
   * Build all context data unique to the Messages tab v2.
   * Only gathers activity feed when the messages tab is active.
   * @param {object} stats - Pre-gathered stats from _gatherStats
   * @returns {object} Context keys for the Messages tab
   * @private
   */
  _gatherMessagesTabContext(stats) {
    // Only compute feed when tab is active (performance)
    if (this._activeTab !== 'messages') {
      return {
        msgFeedEntries: [],
        msgFeedHasMore: false,
        msgFeedTotalCount: 0,
        msgFeedShowing: 0,
        msgQueueEntries: [],
        msgQueueCount: 0,
        msgSentToday: 0,
        msgFeedFilter: this._msgFeedFilter,
        msgFeedSearch: this._msgFeedSearch,
        msgFeedActorFilter: this._msgFeedActorFilter,
        msgFeedActorName: '',
        msgActorDropdownOpen: false,
        msgActorDropdownSearch: '',
        msgActorFilterOptions: [],
        msgFeedDateFrom: this._msgFeedDateFrom,
        msgFeedDateTo: this._msgFeedDateTo,
      };
    }

    const feedResult = this._gatherMessageActivity();
    const feedEntries = feedResult.entries;
    const feedTotalFiltered = feedResult.totalFiltered;
    const queueEntries = this._gatherMessageQueue();
    const actorOptions = this._gatherMsgActorFilterOptions(feedEntries);

    // Resolve actor/contact name for the filter display
    let actorName = '';
    if (this._msgFeedActorFilter) {
      const actor = game.actors?.get(this._msgFeedActorFilter);
      if (actor) {
        actorName = actor.name;
      } else {
        const contact = this.masterContactService?.getContact(this._msgFeedActorFilter);
        actorName = contact?.name ?? this._msgFeedActorFilter;
      }
    }

    // Count sent today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const sentToday = feedEntries.filter(e =>
      e.isSent && e.rawTimestamp >= todayMs
    ).length;

    return {
      msgFeedEntries: feedEntries,
      msgFeedHasMore: feedTotalFiltered > feedEntries.length,
      msgFeedTotalCount: feedTotalFiltered,
      msgFeedShowing: feedEntries.length,
      msgQueueEntries: queueEntries,
      msgQueueCount: queueEntries.length,
      msgSentToday: sentToday,
      msgFeedFilter: this._msgFeedFilter,
      msgFeedSearch: this._msgFeedSearch,
      msgFeedActorFilter: this._msgFeedActorFilter,
      msgFeedActorName: actorName,
      msgActorDropdownOpen: this._msgActorDropdownOpen,
      msgActorDropdownSearch: this._msgActorDropdownSearch,
      msgActorFilterOptions: this._msgActorDropdownSearch
        ? actorOptions.filter(o => o.isGroupLabel || (o.name && o.name.toLowerCase().includes(this._msgActorDropdownSearch.toLowerCase())))
        : actorOptions,
      msgFeedDateFrom: this._msgFeedDateFrom,
      msgFeedDateTo: this._msgFeedDateTo,
    };
  }

  /**
   * Scan all inbox journals and build a flat, sorted, filtered activity feed.
   * @returns {Array<object>} Feed entries
   * @private
   */
  _gatherMessageActivity() {
    const entries = [];

    try {
      // Scan all NCM inbox journals
      for (const journal of game.journal ?? []) {
        if (!journal.name?.startsWith('NCM-Inbox-')) continue;
        const isContactInbox = journal.name.startsWith('NCM-Inbox-Contact-');
        const ownerId = isContactInbox
          ? journal.name.replace('NCM-Inbox-Contact-', '')
          : journal.name.replace('NCM-Inbox-', '');

        for (const page of journal.pages ?? []) {
          const flags = page.flags?.['cyberpunkred-messenger'];
          if (!flags) continue;

          const msgId = flags.messageId || page.id;
          const isSentCopy = msgId.endsWith('-sent');
          const from = flags.senderName || flags.from || 'Unknown';
          const to = flags.recipientName || flags.to || 'Unknown';
          const subject = flags.subject || page.name || '(no subject)';
          const body = flags.body || page.text?.content || '';
          const timestamp = flags.timestamp || '';
          const rawTimestamp = timestamp ? new Date(timestamp).getTime() : 0;
          const isRead = flags.status?.read ?? false;
          const isDeleted = flags.status?.deleted ?? false;
          const network = flags.metadata?.networkTrace || flags.network || 'CITINET';
          const signal = flags.metadata?.signalStrength ?? null;
          const encrypted = flags.status?.encrypted ?? false;
          const attachments = (flags.attachments || []).map(a => ({
            name: typeof a === 'string' ? a : (a.name || a.filename || 'attachment'),
          }));

          // Determine direction
          let dirClass = 'in';
          let dirIcon = 'arrow-down';
          if (isSentCopy) {
            dirClass = 'out';
            dirIcon = 'arrow-up';
          }
          if (flags.isBroadcast || flags.type === 'broadcast') {
            dirClass = 'system';
            dirIcon = 'tower-broadcast';
          }

          // Status
          let statusClass = 'delivered';
          let statusIcon = 'check';
          let statusLabel = 'Delivered';
          if (isDeleted) {
            statusClass = 'deleted';
            statusIcon = 'trash';
            statusLabel = 'Deleted';
          } else if (isSentCopy) {
            statusClass = 'sent';
            statusIcon = 'paper-plane';
            statusLabel = 'Sent';
          } else if (isRead) {
            statusClass = 'read';
            statusIcon = 'check-double';
            statusLabel = 'Read';
          } else if (!isRead) {
            statusClass = 'unread';
            statusIcon = 'envelope';
            statusLabel = 'Unread';
          }

          // Relative time
          const relativeTime = this._relativeTime(timestamp);
          const isRecent = rawTimestamp > 0 && (Date.now() - rawTimestamp) < 600000; // 10 min

          // Full timestamp in cyberpunk format
          const fullTimestamp = timestamp ? formatCyberDate(timestamp) : '';
          // Short date for feed row (date only, respects format setting)
          const shortDate = timestamp ? formatCyberDate(timestamp, { dateOnly: true }) : '';

          // Body preview (strip HTML, truncate)
          let bodyPreview = body.replace(/<[^>]+>/g, '');
          if (bodyPreview.length > 300) bodyPreview = bodyPreview.slice(0, 300) + '...';

          // Determine actor/contact IDs for filter
          const fromActorId = flags.fromActorId || '';
          const toActorId = flags.toActorId || '';
          const fromContactId = flags.fromContactId || '';
          const toContactId = flags.toContactId || '';

          // Network theme data (color + icon from NetworkService)
          const _ns = game.nightcity?.networkService;
          const _netData = _ns?.getNetwork?.(network.toUpperCase()) || _ns?.getNetwork?.(network) || null;
          const networkColor = _netData?.theme?.color || '#8888a0';
          const networkIcon = _netData?.theme?.icon || 'fa-wifi';

          entries.push({
            messageId: msgId,
            inboxOwnerId: ownerId,
            fromName: from,
            toName: to,
            fromActorId,
            toActorId,
            fromContactId,
            toContactId,
            subject,
            bodyPreview,
            dirClass,
            dirIcon,
            statusClass,
            statusIcon,
            statusLabel,
            networkLabel: _netData?.name || network.toUpperCase(),
            networkName: _netData?.name || network,
            networkColor,
            networkIcon,
            signalStrength: signal,
            encrypted,
            attachments,
            relativeTime,
            fullTimestamp,
            shortDate,
            isRecent,
            unread: !isRead && !isSentCopy && !isDeleted,
            isSent: isSentCopy,
            isDeleted,
            rawTimestamp,
            isExpanded: this._expandedMessageId === msgId,
          });
        }
      }
    } catch (error) {
      console.error(`${MODULE_ID} | AdminPanelApp._gatherMessageActivity:`, error);
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => b.rawTimestamp - a.rawTimestamp);

    // Apply filters
    let filtered = entries;

    // Direction filter
    if (this._msgFeedFilter === 'received') {
      filtered = filtered.filter(e => e.dirClass === 'in');
    } else if (this._msgFeedFilter === 'sent') {
      filtered = filtered.filter(e => e.dirClass === 'out');
    } else if (this._msgFeedFilter === 'unread') {
      filtered = filtered.filter(e => e.unread);
    }

    // Actor / Contact filter — cross-resolve linked IDs
    if (this._msgFeedActorFilter) {
      const actId = this._msgFeedActorFilter;

      // Build a set of all IDs that belong to this entity
      // (contact might have a linked actorId, or actorId might map to a contact)
      const matchIds = new Set([actId]);

      // If actId is an actor, find any master contact linked to it
      const linkedContact = (this.masterContactService?.getAll() ?? [])
        .find(c => c.actorId === actId || c.id === actId);
      if (linkedContact) {
        if (linkedContact.id) matchIds.add(linkedContact.id);
        if (linkedContact.actorId) matchIds.add(linkedContact.actorId);
      }

      filtered = filtered.filter(e =>
        matchIds.has(e.fromActorId) || matchIds.has(e.toActorId) ||
        matchIds.has(e.fromContactId) || matchIds.has(e.toContactId) ||
        matchIds.has(e.inboxOwnerId)
      );
    }

    // Search filter
    if (this._msgFeedSearch) {
      const q = this._msgFeedSearch.toLowerCase();
      filtered = filtered.filter(e =>
        e.fromName.toLowerCase().includes(q) ||
        e.toName.toLowerCase().includes(q) ||
        e.subject.toLowerCase().includes(q) ||
        e.bodyPreview.toLowerCase().includes(q)
      );
    }

    // Date range filter
    if (this._msgFeedDateFrom) {
      const fromMs = new Date(this._msgFeedDateFrom + 'T00:00:00').getTime();
      if (!isNaN(fromMs)) filtered = filtered.filter(e => e.rawTimestamp >= fromMs);
    }
    if (this._msgFeedDateTo) {
      const toMs = new Date(this._msgFeedDateTo + 'T23:59:59').getTime();
      if (!isNaN(toMs)) filtered = filtered.filter(e => e.rawTimestamp <= toMs);
    }

    // Track total before limiting (for "Load More" button)
    const totalFiltered = filtered.length;
    return { entries: filtered.slice(0, this._msgFeedLimit), totalFiltered };
  }

  /**
   * Gather messages stuck in the send queue (dead zone / network unavailable).
   * @returns {Array<object>}
   * @private
   */
  _gatherMessageQueue() {
    try {
      const queue = this.messageService?.getQueue?.() ?? [];
      return queue.map(entry => {
        const fromActor = entry.fromActorId ? game.actors?.get(entry.fromActorId) : null;
        const toActor = entry.toActorId ? game.actors?.get(entry.toActorId) : null;
        const reason = entry.reason || 'Network unavailable';
        let reasonIcon = 'network-wired';
        if (reason.toLowerCase().includes('dead zone') || reason.toLowerCase().includes('dead_zone')) {
          reasonIcon = 'signal-slash';
        } else if (reason.toLowerCase().includes('lock') || reason.toLowerCase().includes('auth')) {
          reasonIcon = 'lock';
        }

        const queuedMs = entry.queuedAt ? Date.now() - new Date(entry.queuedAt).getTime() : 0;
        let queuedTime = '';
        if (queuedMs > 0) {
          const mins = Math.floor(queuedMs / 60000);
          if (mins < 60) queuedTime = `${mins}m`;
          else queuedTime = `${Math.floor(mins / 60)}h ${mins % 60}m`;
        }

        return {
          messageId: entry.messageId || entry.id || '',
          fromName: fromActor?.name ?? entry.from ?? 'Unknown',
          toName: toActor?.name ?? entry.to ?? 'Unknown',
          reason,
          reasonIcon,
          queuedTime,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Build actor/contact filter dropdown options from the full roster.
   * Shows ALL master contacts + player actors, with message counts
   * overlaid from the feed. This ensures every NPC is filterable
   * even if their ID mapping in the feed is incomplete.
   * @param {Array<object>} feedEntries - Current feed entries (for counts)
   * @returns {Array<object>}
   * @private
   */
  _gatherMsgActorFilterOptions(feedEntries) {
    // ── Count messages per unique ID from feed ──
    const idCounts = new Map();
    const _inc = (id) => { if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1); };

    for (const entry of feedEntries) {
      _inc(entry.fromActorId);
      _inc(entry.toActorId);
      _inc(entry.fromContactId);
      _inc(entry.toContactId);
      // Also count by inbox owner ID (catches NPC-inbox messages)
      _inc(entry.inboxOwnerId);
    }

    const players = [];
    const npcs = [];
    const seen = new Set();

    // ── Pass 1: Player actors ──
    for (const user of game.users ?? []) {
      if (user.isGM || !user.character) continue;
      const actor = user.character;
      const id = actor.id;
      if (seen.has(id)) continue;
      seen.add(id);

      const count = idCounts.get(id) || 0;
      players.push({
        actorId: id,
        name: actor.name,
        initial: (actor.name || '?').charAt(0).toUpperCase(),
        color: '#19f3f7',
        messageCount: count,
        isActive: this._msgFeedActorFilter === id,
      });
    }

    // ── Pass 2: All master contacts ──
    const masterContacts = this.masterContactService?.getAll() ?? [];
    const roleColors = {
      fixer: '#d4a017', netrunner: '#00e5ff', runner: '#00e5ff',
      corp: '#4a8ab5', exec: '#6ec1e4', solo: '#e04848',
      tech: '#2ecc71', medtech: '#1abc9c', media: '#b87aff',
      nomad: '#d4844a', lawman: '#6b8fa3', rocker: '#e05cb5',
      ripperdoc: '#e06888', gang: '#cc4444', government: '#5a7fa5',
      ai: '#ff44cc',
    };

    for (const contact of masterContacts) {
      // Linked actor — use actor ID, merge count from contact ID + actor ID
      const actorId = contact.actorId;
      const contactId = contact.id;

      // Skip if we already added this as a player character
      if (actorId && seen.has(actorId)) continue;
      if (seen.has(contactId)) continue;

      const primaryId = actorId || contactId;
      seen.add(primaryId);
      if (actorId) seen.add(actorId);
      if (contactId) seen.add(contactId);

      // Merge counts from all possible IDs this contact could appear as
      let count = 0;
      if (actorId) count += (idCounts.get(actorId) || 0);
      if (contactId && contactId !== actorId) count += (idCounts.get(contactId) || 0);

      const roleLower = (contact.role || '').toLowerCase();

      npcs.push({
        actorId: primaryId,
        name: contact.name,
        initial: (contact.name || '?').charAt(0).toUpperCase(),
        color: roleColors[roleLower] || '#F65261',
        messageCount: count,
        isActive: this._msgFeedActorFilter === primaryId,
      });
    }

    // ── Pass 3: NPC actors with emails but NOT in master contacts ──
    for (const actor of game.actors ?? []) {
      if (actor.hasPlayerOwner) continue;
      if (seen.has(actor.id)) continue;
      if (!actor.getFlag(MODULE_ID, 'email')) continue;
      seen.add(actor.id);

      npcs.push({
        actorId: actor.id,
        name: actor.name,
        initial: (actor.name || '?').charAt(0).toUpperCase(),
        color: '#F65261',
        messageCount: idCounts.get(actor.id) || 0,
        isActive: this._msgFeedActorFilter === actor.id,
      });
    }

    // Sort: those with messages first, then alphabetically
    players.sort((a, b) => b.messageCount - a.messageCount || a.name.localeCompare(b.name));
    npcs.sort((a, b) => b.messageCount - a.messageCount || a.name.localeCompare(b.name));

    const options = [];
    if (players.length) {
      options.push({ isGroupLabel: true, label: 'Players' });
      options.push(...players);
    }
    if (npcs.length) {
      options.push({ isGroupLabel: true, label: 'NPCs & Contacts' });
      options.push(...npcs);
    }

    return options;
  }

  /**
   * Gather ALL inboxes — both actor inboxes and contact virtual inboxes.
   * Scans NCM-Inbox-* journals and enriches with actor/contact data.
   * @returns {Array<object>} Unified inbox entries sorted by total messages desc
   * @private
   */
  _gatherAllInboxes() {
    const inboxes = [];
    const seenOwnerIds = new Set();

    try {
      for (const journal of game.journal ?? []) {
        if (!journal.name?.startsWith('NCM-Inbox-')) continue;

        const isContactInbox = journal.name.startsWith('NCM-Inbox-Contact-');
        const ownerId = isContactInbox
          ? journal.name.replace('NCM-Inbox-Contact-', '')
          : journal.name.replace('NCM-Inbox-', '');

        // Skip duplicates (same owner might appear if journals are misconfigured)
        if (seenOwnerIds.has(ownerId)) continue;
        seenOwnerIds.add(ownerId);

        // Count messages and unread
        let totalMessages = 0;
        let unreadMessages = 0;
        for (const page of journal.pages ?? []) {
          const flags = page.flags?.['cyberpunkred-messenger'];
          if (!flags) continue;
          totalMessages++;
          const isSentCopy = (flags.messageId || '').endsWith('-sent');
          if (!flags.status?.read && !isSentCopy && !flags.status?.deleted) {
            unreadMessages++;
          }
        }

        // Skip empty inboxes
        if (totalMessages === 0) continue;

        // Enrich with actor or contact data
        let name = ownerId;
        let avatarColor = '#8888a0';
        let avatarBorderColor = 'rgba(136,136,160,0.4)';
        let initial = '?';
        let img = null;
        let ownerLabel = 'NPC';
        let isPlayer = false;

        if (!isContactInbox) {
          // Actor inbox
          const actor = game.actors?.get(ownerId);
          if (actor) {
            name = actor.name;
            initial = (actor.name || '?').charAt(0).toUpperCase();
            img = actor.img && !actor.img.includes('mystery-man') ? actor.img : null;
            isPlayer = actor.hasPlayerOwner;

            if (isPlayer) {
              avatarColor = '#19f3f7';
              avatarBorderColor = 'rgba(25,243,247,0.4)';
              // Find player owner name
              const ownerEntry = Object.entries(actor.ownership || {})
                .find(([uid, level]) => uid !== 'default' && level >= 3);
              const ownerUser = ownerEntry ? game.users.get(ownerEntry[0]) : null;
              ownerLabel = ownerUser?.name ?? 'Player';
            } else {
              avatarColor = '#F65261';
              avatarBorderColor = 'rgba(246,82,97,0.4)';
              ownerLabel = 'NPC';
            }
          }
        } else {
          // Contact virtual inbox
          const contact = this.masterContactService?.getContact(ownerId);
          if (contact) {
            name = contact.name;
            initial = (contact.name || '?').charAt(0).toUpperCase();
            img = contact.portrait || null;

            // Role-based color
            const roleLower = (contact.role || '').toLowerCase();
            const roleColors = {
              fixer: '#d4a017', netrunner: '#00e5ff', runner: '#00e5ff',
              corp: '#4a8ab5', exec: '#6ec1e4', solo: '#e04848',
              tech: '#2ecc71', medtech: '#1abc9c', media: '#b87aff',
              nomad: '#d4844a', lawman: '#6b8fa3', rocker: '#e05cb5',
            };
            avatarColor = roleColors[roleLower] || '#F65261';
            avatarBorderColor = `${avatarColor}66`;
            ownerLabel = contact.role ? contact.role.charAt(0).toUpperCase() + contact.role.slice(1) : 'NPC';
          }
        }

        inboxes.push({
          inboxId: ownerId,
          name,
          initial,
          img,
          avatarColor,
          avatarBorderColor,
          isPlayer,
          ownerLabel,
          totalMessages,
          unreadMessages,
          isContactInbox,
        });
      }
    } catch (error) {
      console.error(`${MODULE_ID} | AdminPanelApp._gatherAllInboxes:`, error);
    }

    // Sort: players first, then by total messages descending
    inboxes.sort((a, b) => {
      if (a.isPlayer && !b.isPlayer) return -1;
      if (!a.isPlayer && b.isPlayer) return 1;
      return b.totalMessages - a.totalMessages;
    });

    return inboxes;
  }

  /**
   * Gather contact summary for the Contacts tab.
   * @returns {object}
   * @private
   */
  _gatherContactSummary() {
    const contacts = this.masterContactService?.getAll() ?? [];

    // ── Role config ──
    // ── Role config — every role gets a unique type + color ──
    const roleChipMap = {
      fixer:     { label: 'Fixer',     type: 'role-fixer',     icon: 'crosshairs' },
      netrunner: { label: 'Runner',    type: 'role-netrunner',  icon: 'terminal' },
      runner:    { label: 'Runner',    type: 'role-netrunner',  icon: 'terminal' },
      corp:      { label: 'Corp',      type: 'role-corp',       icon: 'briefcase' },
      exec:      { label: 'Exec',      type: 'role-exec',       icon: 'building-columns' },
      solo:      { label: 'Solo',      type: 'role-solo',       icon: 'crosshairs' },
      tech:      { label: 'Tech',      type: 'role-tech',       icon: 'gear' },
      medtech:   { label: 'Medtech',   type: 'role-medtech',    icon: 'staff-snake' },
      ripperdoc: { label: 'Ripperdoc', type: 'role-ripperdoc',  icon: 'syringe' },
      media:     { label: 'Media',     type: 'role-media',      icon: 'podcast' },
      nomad:     { label: 'Nomad',     type: 'role-nomad',      icon: 'truck-monster' },
      lawman:    { label: 'Lawman',    type: 'role-lawman',     icon: 'shield-halved' },
      rockerboy: { label: 'Rocker',    type: 'role-rocker',     icon: 'guitar' },
      rocker:    { label: 'Rocker',    type: 'role-rocker',     icon: 'guitar' },
      gang:       { label: 'Gang',       type: 'role-gang',       icon: 'users-line' },
      civilian:   { label: 'Civilian',   type: 'role-civilian',   icon: 'user' },
      government: { label: 'Gov',        type: 'role-gov',        icon: 'landmark' },
      ai:         { label: 'A.I.',       type: 'role-ai',         icon: 'microchip' },
    };

    // Merge custom roles from GM settings
    const customRoles = this.masterContactService?.getCustomRoles?.() || [];
    for (const cr of customRoles) {
      if (!roleChipMap[cr.id]) {
        roleChipMap[cr.id] = { label: cr.label, type: `role-${cr.id}`, icon: cr.icon || 'tag' };
      }
    }

    const trustLabels = { 5: 'Implicitly Trusted', 4: 'Trusted', 3: 'Neutral', 2: 'Cautious', 1: 'Suspicious', 0: 'Unknown' };

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

    // ── Relationship type config (used in enriched contact per-player display) ──
    const RELATIONSHIP_TYPES = {
      ally:       { label: 'ALLY',       icon: 'fa-handshake',            color: '#00ff41' },
      hostile:    { label: 'HOSTILE',    icon: 'fa-skull-crossbones',     color: '#ff0033' },
      rival:      { label: 'RIVAL',     icon: 'fa-bolt',                 color: '#b87aff' },
      neutral:    { label: 'NEUTRAL',   icon: 'fa-minus',                color: '#555570' },
      contact:    { label: 'CONTACT',   icon: 'fa-address-card',         color: '#7aa2c4' },
      'owes-you': { label: 'OWES YOU',  icon: 'fa-coins',                color: '#f7c948' },
      'you-owe':  { label: 'YOU OWE',   icon: 'fa-hand-holding-dollar',  color: '#d4844a' },
      patron:     { label: 'PATRON',    icon: 'fa-crown',                color: '#6ec1e4' },
      informant:  { label: 'INFORMANT', icon: 'fa-user-secret',          color: '#1abc9c' },
    };

    // ── Enrich all master contacts ──
    const enriched = contacts.map(c => {
      const trust = c.trust ?? 0;
      let trustLevel = 'none';
      if (trust >= 4) trustLevel = 'high';
      else if (trust >= 2) trustLevel = 'med';
      else if (trust >= 1) trustLevel = 'low';

      // Detect role — from c.role field first, then scan tags as fallback
      let roleLower = (c.role || '').toLowerCase();
      if (!roleLower) {
        // Scan tags for known role names
        const knownRoles = Object.keys(roleChipMap);
        for (const tag of (c.tags || [])) {
          const tagLower = tag.toLowerCase();
          if (knownRoles.includes(tagLower)) {
            roleLower = tagLower;
            break;
          }
        }
      }
      const roleInfo = roleChipMap[roleLower];

      // Avatar color — per-role colors matching chip colors, with burned/encrypted overrides
      const roleAvatarColors = {
        fixer: '#d4a017',
        netrunner: '#00e5ff', runner: '#00e5ff',
        corp: '#4a8ab5', exec: '#6ec1e4',
        solo: '#e04848',
        tech: '#2ecc71', medtech: '#1abc9c', ripperdoc: '#e06888',
        media: '#b87aff',
        nomad: '#d4844a',
        lawman: '#6b8fa3',
        rockerboy: '#e05cb5', rocker: '#e05cb5',
        gang: '#cc4444', civilian: '#8888a0',
        government: '#5a7fa5', ai: '#ff44cc',
      };
      // Merge custom role colors
      for (const cr of customRoles) {
        if (cr.color && !roleAvatarColors[cr.id]) roleAvatarColors[cr.id] = cr.color;
      }
      let avatarColor = roleAvatarColors[roleLower] || '#9a9ab5';
      if (c.burned) avatarColor = '#ff3355';
      else if (c.encrypted) avatarColor = '#f7c948';
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

      // Build color-coded chips with inline styles (Foundry-proof)
      // Every role gets a visually distinct color
      const chipColorMap = {
        'role-fixer':     { c: '#d4a017', b: 'rgba(212,160,23,0.35)', bg: 'rgba(212,160,23,0.10)' },
        'role-netrunner': { c: '#00e5ff', b: 'rgba(0,229,255,0.35)',  bg: 'rgba(0,229,255,0.10)' },
        'role-corp':      { c: '#4a8ab5', b: 'rgba(74,138,181,0.35)', bg: 'rgba(74,138,181,0.10)' },
        'role-exec':      { c: '#6ec1e4', b: 'rgba(110,193,228,0.35)', bg: 'rgba(110,193,228,0.10)' },
        'role-solo':      { c: '#e04848', b: 'rgba(224,72,72,0.35)',  bg: 'rgba(224,72,72,0.10)' },
        'role-tech':      { c: '#2ecc71', b: 'rgba(46,204,113,0.35)', bg: 'rgba(46,204,113,0.10)' },
        'role-medtech':   { c: '#1abc9c', b: 'rgba(26,188,156,0.35)', bg: 'rgba(26,188,156,0.10)' },
        'role-ripperdoc': { c: '#e06888', b: 'rgba(224,104,136,0.35)', bg: 'rgba(224,104,136,0.10)' },
        'role-media':     { c: '#b87aff', b: 'rgba(184,122,255,0.35)', bg: 'rgba(184,122,255,0.10)' },
        'role-nomad':     { c: '#d4844a', b: 'rgba(212,132,74,0.35)',  bg: 'rgba(212,132,74,0.10)' },
        'role-lawman':    { c: '#6b8fa3', b: 'rgba(107,143,163,0.35)', bg: 'rgba(107,143,163,0.10)' },
        'role-rocker':    { c: '#e05cb5', b: 'rgba(224,92,181,0.35)', bg: 'rgba(224,92,181,0.10)' },
        'role-gang':      { c: '#cc4444', b: 'rgba(204,68,68,0.35)',  bg: 'rgba(204,68,68,0.10)' },
        'role-civilian':  { c: '#8888a0', b: 'rgba(136,136,160,0.35)', bg: 'rgba(136,136,160,0.10)' },
        'role-gov':       { c: '#5a7fa5', b: 'rgba(90,127,165,0.35)', bg: 'rgba(90,127,165,0.10)' },
        'role-ai':        { c: '#ff44cc', b: 'rgba(255,68,204,0.35)', bg: 'rgba(255,68,204,0.10)' },
        'org':            { c: '#7aa2c4', b: 'rgba(122,162,196,0.35)', bg: 'rgba(122,162,196,0.10)' },
        'loc':            { c: '#c47a2a', b: 'rgba(196,122,42,0.35)',  bg: 'rgba(196,122,42,0.10)' },
        'tag':            { c: '#19f3f7', b: 'rgba(25,243,247,0.30)',  bg: 'rgba(25,243,247,0.08)' },
        'alias':          { c: '#c8c8dc', b: 'rgba(200,200,220,0.30)', bg: 'rgba(200,200,220,0.06)' },
      };
      // Merge custom role chip colors dynamically
      for (const cr of customRoles) {
        const key = `role-${cr.id}`;
        if (!chipColorMap[key] && cr.color) {
          const r = parseInt(cr.color.slice(1, 3), 16);
          const g = parseInt(cr.color.slice(3, 5), 16);
          const b = parseInt(cr.color.slice(5, 7), 16);
          chipColorMap[key] = {
            c: cr.color,
            b: `rgba(${r},${g},${b},0.35)`,
            bg: `rgba(${r},${g},${b},0.10)`,
          };
        }
      }
      const _chipStyle = (type) => {
        const cm = chipColorMap[type];
        return cm ? `color:${cm.c};border-color:${cm.b};background:${cm.bg};` : '';
      };

      const chips = [];
      if (roleInfo) chips.push({ type: roleInfo.type, label: roleInfo.label, icon: roleInfo.icon, style: _chipStyle(roleInfo.type) });
      if (c.organization) chips.push({ type: 'org', label: c.organization, icon: 'building', style: _chipStyle('org') });
      if (c.location) chips.push({ type: 'loc', label: c.location, icon: 'location-dot', style: _chipStyle('loc') });
      if (c.alias) chips.push({ type: 'alias', label: c.alias, icon: null, style: _chipStyle('alias') });
      if (c.tags) {
        c.tags.forEach(t => {
          // Skip tags that were already used as the role chip
          if (roleLower && t.toLowerCase() === roleLower) return;
          chips.push({ type: 'tag', label: t, icon: null, style: _chipStyle('tag') });
        });
      }

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

      // Per-player relationship summary for expanded detail
      const rels = c.relationships || {};
      const partyTrust = trust;
      const playerRelationships = playerActors.map(pa => {
        const rel = rels[pa.actorId] || {};
        const relType = rel.type || '';
        const relData = RELATIONSHIP_TYPES[relType];
        const playerTrust = rel.trust != null ? rel.trust : partyTrust;
        const isOverride = rel.trust != null && rel.trust !== partyTrust;
        const _badgeStyle = (color) => {
          if (!color) return '';
          const rr = parseInt(color.slice(1, 3), 16);
          const gg = parseInt(color.slice(3, 5), 16);
          const bb = parseInt(color.slice(5, 7), 16);
          return `color:${color};border-color:rgba(${rr},${gg},${bb},0.35);background:rgba(${rr},${gg},${bb},0.08);`;
        };
        return {
          actorId: pa.actorId,
          characterName: pa.actorName,
          playerName: pa.playerName,
          initial: pa.initial,
          relType,
          relBadgeLabel: relData?.label || '',
          relIcon: relData?.icon || '',
          relBadgeStyle: relData ? _badgeStyle(relData.color) : '',
          displayTrust: playerTrust,
          partyTrust,
          isOverride,
          trustSegments: [1, 2, 3, 4, 5].map(v => ({ value: v, active: v <= playerTrust })),
          hasNote: !!rel.note,
          note: rel.note || '',
        };
      });
      const hasPlayerRelationships = playerRelationships.some(pr => pr.relType || pr.hasNote || pr.isOverride);

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
        // Per-player relationships (for expanded detail)
        playerRelationships,
        hasPlayerRelationships,
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
        playerRelationships: [], hasPlayerRelationships: false,
        recentMessages: [],
      });
    }

    // ── Populate recent messages for expanded contact ──
    const expandedContact = enriched.find(c => c.isExpanded);
    if (expandedContact && !expandedContact.noInbox) {
      try {
        const contactId = expandedContact.id;
        const actorId = expandedContact.actorId;
        const allMessages = [];

        // Messages in the contact's OWN inbox
        // Contains BOTH received messages AND sent copies (messageId ending in "-sent")
        // The viewer's auto-filter-switch handles navigating to the correct tab
        const ownJournalName = actorId
          ? `NCM-Inbox-${actorId}`
          : `NCM-Inbox-Contact-${contactId}`;
        const ownInbox = game.journal?.find(j => j.name === ownJournalName);
        if (ownInbox?.pages?.size) {
          for (const page of ownInbox.pages) {
            const flags = page.flags?.['cyberpunkred-messenger'] || {};
            const msgId = flags.messageId || '';
            const isSentCopy = msgId.endsWith('-sent');

            allMessages.push({
              page, flags,
              sent: isSentCopy,
              // Always open the contact's own inbox — viewer auto-switches filter
              openInboxId: actorId || contactId,
              openMessageId: msgId,
            });
          }
        }

        // Sort all messages by timestamp descending, take top 3
        allMessages.sort((a, b) =>
          (b.flags.timestamp || '').localeCompare(a.flags.timestamp || '')
        );

        expandedContact.recentMessages = allMessages.slice(0, 3).map(m => {
          const fromName = m.flags.senderName || m.flags.from || '?';
          const toName = m.flags.recipientName || m.flags.to || '?';
          return {
            from: fromName,
            to: toName,
            sent: m.sent,
            preview: (m.flags.subject || m.page.name || '(no subject)').slice(0, 50),
            time: m.flags.timestamp ? this._relativeTime(m.flags.timestamp) : '',
            messageId: m.openMessageId,
            inboxOwnerId: m.openInboxId,
          };
        });
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
    const liveNetId = this.networkService?.currentNetworkId;
    const liveSignal = this.networkService?.signalStrength ?? 0;
    const liveNet = liveNetId ? allNetworks.find(n => n.id === liveNetId) : null;

    return (game.scenes?.contents ?? []).map(s => {
      const deadZone = s.getFlag(MODULE_ID, 'deadZone') ?? false;
      const defaultNetId = s.getFlag(MODULE_ID, 'defaultNetwork') ?? '';
      const defaultNet = allNetworks.find(n => n.id === defaultNetId || n.name === defaultNetId);
      const isCurrent = s.id === currentSceneId;

      // Current scene: use live network state; other scenes: use configured default
      let networkName, signalPct;
      if (deadZone) {
        networkName = 'DEAD ZONE';
        signalPct = 0;
      } else if (isCurrent && liveNet) {
        networkName = liveNet.name;
        signalPct = liveSignal;
      } else if (defaultNet) {
        networkName = defaultNet.name;
        signalPct = defaultNet.signalStrength ?? 75;
      } else {
        networkName = 'No network';
        signalPct = 0;
      }

      const signalTier = deadZone ? 'dead' : (signalPct >= 70 ? 'good' : (signalPct >= 40 ? 'mid' : 'low'));
      return {
        id: s.id,
        name: s.name,
        isCurrent,
        deadZone,
        defaultNetworkName: networkName,
        signalPct,
        signalTier,
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

    // Post-filter for trace
    if (this._logTypeFilter === 'trace') {
      entries = entries.filter(e => e.type === 'trace' || e.type === 'shard_trace' || e.type === 'message_trace');
    }

    return entries.map(e => this._formatLogEntry(e));
  }

  /**
   * Format a single log entry for template display (who-did-what sentence format).
   * @param {object} e - Raw AccessLogEntry
   * @returns {object} Formatted entry with badge, sentence parts, type tag, link data
   * @private
   */
  _formatLogEntry(e) {
    const type = e.type ?? 'system';
    const isTrace = type === 'trace' || type === 'shard_trace' || type === 'message_trace';

    // Badge icon + class
    const BADGE = {
      connect: { icon: 'fa-plug', cls: 'connect' },
      disconnect: { icon: 'fa-plug-circle-xmark', cls: 'disconnect' },
      auth_success: { icon: 'fa-lock-open', cls: 'auth_success' },
      auth_failure: { icon: 'fa-lock', cls: 'auth_failure' },
      lockout: { icon: 'fa-ban', cls: 'lockout' },
      dead_zone: { icon: 'fa-signal-slash', cls: 'system' },
      network_switch: { icon: 'fa-arrows-rotate', cls: 'network_switch' },
      hack: { icon: 'fa-skull-crossbones', cls: 'hack' },
      manual: { icon: 'fa-user-secret', cls: 'manual' },
      malware: { icon: 'fa-virus', cls: 'hack' },
      system: { icon: 'fa-signal-slash', cls: 'system' },
      trace: { icon: 'fa-eye', cls: 'trace' },
      message_trace: { icon: 'fa-eye', cls: 'trace' },
      shard_trace: { icon: 'fa-satellite-dish', cls: 'trace' },
    };
    const badge = BADGE[type] ?? { icon: 'fa-circle-info', cls: 'system' };

    // Action verb (the "did what" part of the sentence)
    const VERBS = {
      connect: 'connected to',
      disconnect: 'disconnected from',
      auth_success: 'authenticated on',
      auth_failure: 'failed auth on',
      lockout: 'locked out of',
      dead_zone: 'lost signal on',
      network_switch: 'switched to',
      hack: 'attempted hack on',
      manual: 'logged entry on',
      malware: 'detected malware on',
      system: 'system event on',
      trace: 'was traced on',
      message_trace: 'sent traced message on',
      shard_trace: 'triggered shard trace on',
    };

    // Type tag label + CSS class
    const TAGS = {
      connect: { label: 'Connect', cls: 'connect' },
      disconnect: { label: 'Disconnect', cls: 'disconnect' },
      auth_success: { label: 'Auth OK', cls: 'auth-ok' },
      auth_failure: { label: 'Auth Fail', cls: 'auth-fail' },
      lockout: { label: 'Lockout', cls: 'lockout' },
      dead_zone: { label: 'Dead Zone', cls: 'system' },
      network_switch: { label: 'Switch', cls: 'switch' },
      hack: { label: 'Hack', cls: 'hack' },
      manual: { label: 'Manual', cls: 'manual' },
      malware: { label: 'Malware', cls: 'hack' },
      system: { label: 'System', cls: 'system' },
      trace: { label: 'Trace', cls: 'trace' },
      message_trace: { label: 'Trace', cls: 'trace' },
      shard_trace: { label: 'Shard Trace', cls: 'trace' },
    };
    const tag = TAGS[type] ?? { label: type?.toUpperCase() ?? 'EVENT', cls: 'system' };

    // Network color class
    const netName = (e.networkName ?? e.networkId ?? '').toUpperCase();
    let networkColor = 'cyan';
    if (netName.includes('CORP') || netName.includes('GOV')) networkColor = 'gold';
    else if (netName.includes('DARK')) networkColor = 'purple';
    else if (netName.includes('DEAD') || netName.includes('BADLAND')) networkColor = 'red';

    // Link data from extra field
    const extra = e.extra ?? {};
    const hasLink = !!(extra.messageId || extra.itemId);
    let linkType = '', linkLabel = '', linkIcon = '';
    if (extra.itemId) {
      linkType = 'shard';
      linkLabel = 'View Shard';
      linkIcon = 'fa-microchip';
    } else if (extra.messageId) {
      linkType = 'message';
      linkLabel = 'View Message';
      linkIcon = 'fa-envelope';
    }

    return {
      ...e,
      displayTime: this._formatLogTime(e.timestamp),
      displayDate: this._formatLogDate(e.timestamp),
      badgeIcon: badge.icon,
      badgeClass: badge.cls,
      actorName: e.actorName ?? 'System',
      actorImg: (() => {
        // Try explicit actorId first
        if (e.actorId) {
          const img = game.actors?.get(e.actorId)?.img;
          if (img && !img.includes('mystery-man')) return img;
        }
        // Fall back to userId → user's assigned character
        if (e.userId) {
          const user = game.users?.get(e.userId);
          const img = user?.character?.img;
          if (img && !img.includes('mystery-man')) return img;
        }
        return null;
      })(),
      actionVerb: VERBS[type] ?? 'event on',
      networkName: e.networkName ?? e.networkId ?? '—',
      networkColor,
      typeTag: tag.label,
      typeTagClass: tag.cls,
      message: e.message ?? '',
      isTrace,
      hasLink,
      linkType,
      linkLabel,
      linkIcon,
      linkMessageId: extra.messageId ?? '',
      linkActorId: extra.actorId ?? e.actorId ?? '',
      linkItemId: extra.itemId ?? '',
    };
  }

  /** @private */
  _formatLogTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  }

  /** @private */
  _formatLogDate(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}.${d.getUTCFullYear()}`;
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
    const deliveryDate = `${dt.getUTCDate().toString().padStart(2, '0')}.${(dt.getUTCMonth() + 1).toString().padStart(2, '0')}.${dt.getUTCFullYear()} // ${dt.getUTCHours().toString().padStart(2, '0')}:${dt.getUTCMinutes().toString().padStart(2, '0')}`;

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

      // Reset scroll to top when switching sub-views
      if (this._pendingContentScrollReset) {
        this._pendingContentScrollReset = false;
        if (el) el.scrollTop = 0;
      } else if (el && this._scrollPositions[this._activeTab]) {
        el.scrollTop = this._scrollPositions[this._activeTab];
      }

      // Restore feed list internal scroll
      const feedList = this.element?.querySelector('.ncm-msg-feed-list');
      if (feedList && this._feedListScroll) {
        feedList.scrollTop = this._feedListScroll;
      }

      // Attach passive scroll listener to continuously track position
      this._attachScrollTracker(el);
    });

    // ── Messages tab: wire search input ──
    if (this._activeTab === 'messages') {
      this._setupMessagesControls();
    }

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
   * Wire up messages tab controls:
   * - Feed search input (debounced)
   * - NPC send-as search input (debounced)
   * - Scheduled countdown ticking interval
   * - Actor filter dropdown click-outside-to-close
   */
  _setupMessagesControls() {
    // ── Feed search input ──
    const searchInput = this.element?.querySelector('.ncm-msg-feed-search__input');
    if (searchInput) {
      if (this._msgFeedSearch) {
        searchInput.value = this._msgFeedSearch;
        searchInput.focus();
        const len = this._msgFeedSearch.length;
        searchInput.setSelectionRange(len, len);
      }

      const handler = this._msgSearchHandler || (this._msgSearchHandler =
        foundry.utils.debounce((e) => {
          this._msgFeedSearch = e.target.value;
          this._msgFeedLimit = 20;
          this.render(true);
        }, 350)
      );
      searchInput.removeEventListener('input', handler);
      searchInput.addEventListener('input', handler);
    }

    // ── NPC send-as search input ──
    const npcSearch = this.element?.querySelector('.ncm-msg-npc-search__input');
    if (npcSearch) {
      if (this._npcSendSearch) {
        npcSearch.value = this._npcSendSearch;
        npcSearch.focus();
        const len = this._npcSendSearch.length;
        npcSearch.setSelectionRange(len, len);
      }

      const npcHandler = this._npcSearchHandler || (this._npcSearchHandler =
        foundry.utils.debounce((e) => {
          this._npcSendSearch = e.target.value;
          this._npcSendPage = 0;
          this.render(true);
        }, 350)
      );
      npcSearch.removeEventListener('input', npcHandler);
      npcSearch.addEventListener('input', npcHandler);
    }

    // ── Actor filter dropdown search input ──
    const actorDdSearch = this.element?.querySelector('.ncm-msg-actor-dd-search__input');
    if (actorDdSearch) {
      if (this._msgActorDropdownSearch) {
        actorDdSearch.value = this._msgActorDropdownSearch;
        actorDdSearch.focus();
        const len = this._msgActorDropdownSearch.length;
        actorDdSearch.setSelectionRange(len, len);
      } else if (this._msgActorDropdownOpen) {
        actorDdSearch.focus();
      }

      const actorDdHandler = this._actorDdSearchHandler || (this._actorDdSearchHandler =
        foundry.utils.debounce((e) => {
          this._msgActorDropdownSearch = e.target.value;
          this.render(true);
        }, 200)
      );
      actorDdSearch.removeEventListener('input', actorDdHandler);
      actorDdSearch.addEventListener('input', actorDdHandler);
    }

    // ── Scheduled countdown ticking ──
    // Clear any previous interval
    if (this._schedCountdownInterval) {
      clearInterval(this._schedCountdownInterval);
      this._schedCountdownInterval = null;
    }

    const countdownEls = this.element?.querySelectorAll('[data-delivery-time]');
    if (countdownEls?.length) {
      const ts = game.nightcity?.timeService;

      this._schedCountdownInterval = setInterval(() => {
        // Self-clean if tab switched or panel closed
        const firstEl = this.element?.querySelector('[data-delivery-time]');
        if (!firstEl || this._activeTab !== 'messages') {
          clearInterval(this._schedCountdownInterval);
          this._schedCountdownInterval = null;
          return;
        }

        for (const el of this.element.querySelectorAll('[data-delivery-time]')) {
          const deliveryIso = el.dataset.deliveryTime;
          const useGameTime = el.dataset.useGameTime === 'true';

          const nowIso = useGameTime
            ? (ts?.getCurrentTime() ?? new Date().toISOString())
            : new Date().toISOString();

          const nowMs = new Date(nowIso).getTime();
          const deliveryMs = new Date(deliveryIso).getTime();
          const diffMs = Math.max(0, deliveryMs - nowMs);
          const diffSec = Math.floor(diffMs / 1000);

          const hours = Math.floor(diffSec / 3600);
          const mins = Math.floor((diffSec % 3600) / 60);
          const secs = diffSec % 60;
          const countdown = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

          el.textContent = countdown;

          // Update soon class
          const isSoon = diffMs < 5 * 60 * 1000;
          el.classList.toggle('ncm-msg-sched-row__countdown--soon', isSoon);
        }
      }, 1000);
    }

    // ── Close actor dropdown when clicking outside ──
    if (this._msgActorDropdownOpen) {
      const closeDropdown = (e) => {
        if (!e.target.closest('.ncm-msg-actor-filter')) {
          this._msgActorDropdownOpen = false;
          this._msgActorDropdownSearch = '';
          this.render(true);
          document.removeEventListener('pointerdown', closeDropdown);
        }
      };
      setTimeout(() => document.addEventListener('pointerdown', closeDropdown), 0);
    }
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
    const netFilter = this.element?.querySelector('.ncm-actlog__net-filter');
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
    // Messages — with overview activity logging
    this.subscribe(EVENTS.MESSAGE_SENT, (data) => {
      const from = data?.fromName || game.actors.get(data?.fromActorId)?.name || 'Unknown';
      const to = data?.toName || game.actors.get(data?.toActorId)?.name || 'Unknown';
      this._logOverviewActivity('msg', 'paper-plane',
        `<strong>${from}</strong> sent message to <span class="ncm-ov-hl--cyan">${to}</span>`,
        { actorId: data?.fromActorId });
      this._refreshIfTab('overview', 'messages');
    });
    this.subscribe(EVENTS.MESSAGE_RECEIVED, (data) => {
      const from = data?.fromName || game.actors.get(data?.fromActorId)?.name || 'Unknown';
      const to = data?.toName || game.actors.get(data?.toActorId)?.name || 'Unknown';
      this._logOverviewActivity('msg', 'envelope',
        `<strong>${to}</strong> received message from <span class="ncm-ov-hl--cyan">${from}</span>`,
        { actorId: data?.toActorId });
      this._refreshIfTab('overview', 'messages');
    });
    this.subscribe(EVENTS.MESSAGE_SCHEDULED, (data) => {
      this._logOverviewActivity('msg', 'clock',
        `Message scheduled for delivery`,
        {});
      this._refreshIfTab('overview', 'messages');
    });
    this.subscribe(EVENTS.MESSAGE_DELETED, () => this._refreshIfTab('overview', 'messages'));
    this.subscribe('schedule:updated', () => this._refreshIfTab('overview', 'messages'));

    // Contacts — with overview activity logging
    this.subscribe(EVENTS.CONTACT_TRUST_CHANGED, () => this._refreshIfTab('contacts'));
    this.subscribe(EVENTS.CONTACT_BURNED, () => this._refreshIfTab('contacts'));
    this.subscribe(EVENTS.CONTACT_SHARED, (data) => {
      const contactName = data?.contactName || 'Unknown';
      const targetName = data?.targetActorName || game.actors.get(data?.targetActorId)?.name || 'Unknown';
      this._logOverviewActivity('contact', 'user-plus',
        `Contact <span class="ncm-ov-hl--purple">"${contactName}"</span> pushed to ${targetName}`,
        {});
      this._refreshIfTab('overview', 'contacts');
    });
    this.subscribe(EVENTS.CONTACT_UPDATED, () => this._debouncedRender());

    // Networks — with overview activity logging
    this.subscribe(EVENTS.NETWORK_CHANGED, (data) => {
      const netName = data?.networkName || data?.networkId || 'Unknown';
      this._logOverviewActivity('net', 'wifi',
        `Network switched to <span class="ncm-ov-hl--green">${netName}</span>`,
        {});
      this._refreshIfTab('networks', 'overview');
    });
    this.subscribe(EVENTS.NETWORK_CONNECTED, (data) => {
      const netName = data?.networkName || data?.networkId || 'Unknown';
      this._logOverviewActivity('net', 'plug',
        `Connected to network <span class="ncm-ov-hl--green">${netName}</span>`,
        {});
      this._refreshIfTab('networks', 'overview');
    });
    this.subscribe(EVENTS.NETWORK_DISCONNECTED, (data) => {
      const netName = data?.networkName || data?.networkId || 'Unknown';
      this._logOverviewActivity('net', 'ban',
        `Disconnected from network <span class="ncm-ov-hl--red">${netName}</span>`,
        {});
      this._refreshIfTab('networks', 'overview');
    });
    this.subscribe(EVENTS.NETWORK_AUTH_SUCCESS, () => this._refreshIfTab('networks'));
    this.subscribe(EVENTS.NETWORK_AUTH_FAILURE, () => this._refreshIfTab('networks'));
    this.subscribe(EVENTS.NETWORK_LOCKOUT, () => this._refreshIfTab('networks'));

    // Data Shards — with overview activity logging
    this.subscribe(EVENTS.SHARD_DECRYPTED, (data) => {
      this._logShardActivity('success', 'check', data, 'breached');
      const actorName = data.actorId ? game.actors?.get(data.actorId)?.name : 'GM';
      const shardName = data.itemId ? game.items?.get(data.itemId)?.name : 'Unknown';
      this._logOverviewActivity('shard', 'unlock',
        `<strong>${actorName || 'Unknown'}</strong> breached shard <span class="ncm-ov-hl--gold">"${shardName}"</span>`,
        { itemId: data.itemId });
      this._refreshIfTab('overview', 'shards');
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
      const shardName = data.itemId ? game.items?.get(data.itemId)?.name : 'New Shard';
      this._logOverviewActivity('shard', 'database',
        `Data shard <span class="ncm-ov-hl--gold">"${shardName}"</span> created`,
        { itemId: data.itemId });
      this._refreshIfTab('overview', 'shards');
    });
    this.subscribe(EVENTS.SHARD_STATE_CHANGED, () => this._debouncedRender());
    this.subscribe(EVENTS.SHARD_INTEGRITY_CHANGED, (data) => {
      this._logShardActivity('fail', 'triangle-exclamation', data, `integrity → ${data.newIntegrity}%`);
      this._refreshIfTab('shards');
    });
    this.subscribe(EVENTS.BLACK_ICE_DAMAGE, (data) => {
      const actorName = data.actorId ? game.actors?.get(data.actorId)?.name : 'Unknown';
      const damage = data.damage || '?';
      this._logOverviewActivity('alert', 'shield-virus',
        `<span class="ncm-ov-hl--red">BLACK ICE</span> dealt ${damage} HP damage to <strong>${actorName}</strong>`,
        { actorId: data.actorId });
      this._refreshIfTab('overview');
    });
    this.subscribe(EVENTS.SHARD_EDDIES_CLAIMED, (data) => {
      this._logShardActivity('success', 'coins', data, `claimed ${data.amount?.toLocaleString() ?? '?'} eb`);
      const actorName = data.actorId ? game.actors?.get(data.actorId)?.name : 'Unknown';
      this._logOverviewActivity('shard', 'coins',
        `<strong>${actorName}</strong> claimed <span class="ncm-ov-hl--gold">${data.amount?.toLocaleString() ?? '?'} eb</span>`,
        { actorId: data.actorId });
      this._refreshIfTab('overview', 'shards');
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

    game.nightcity?.openInbox?.(actorId);
    log.info(`Admin: Opening inbox for ${actorId}`);
  }

  static _onOpenAllInboxes(event, target) {
    // Open inbox for each actor with messages — limited to prevent window spam
    const actors = game.actors.filter(a =>
      a.hasPlayerOwner || a.getFlag(MODULE_ID, 'email')
    ).slice(0, 4);

    for (const actor of actors) {
      game.nightcity?.openInbox?.(actor.id);
    }
  }

  /**
   * Overview: Compose as a specific actor (from actor card buttons).
   */
  static _onOvComposeAs(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    game.nightcity?.openComposer?.({ fromActorId: actorId, fromName: actor.name });
    log.info(`Admin Overview: Compose as ${actor.name}`);
  }

  /**
   * Overview: Quick-create a new data shard — switches to Shards tab
   * where the quick-create preset buttons live.
   */
  static _onOvNewShard(event, target) {
    this._activeTab = 'shards';
    this.render(true);
    log.info('Admin Overview: Switching to Shards tab for creation');
  }

  /**
   * Overview: Open the broadcast dialog.
   * Switches to the Networks tab which has the broadcast bar.
   */
  static _onOvBroadcast(event, target) {
    // Switch to networks tab where the broadcast UI lives
    this._activeTab = 'networks';
    this.render(true);
    log.info('Admin Overview: Switching to Networks for broadcast');
  }

  /**
   * Overview: Dismiss all alerts for this session.
   */
  static _onOvClearAlerts(event, target) {
    // Gather all current alert keys and dismiss them
    const alertEls = this.element?.querySelectorAll('[data-alert-key]') ?? [];
    for (const el of alertEls) {
      const key = el.dataset.alertKey;
      if (key) this._dismissedAlerts.add(key);
    }
    this.render(true);
  }

  /**
   * Overview: Dismiss a single alert by key.
   */
  static _onOvDismissAlert(event, target) {
    const key = target.closest('[data-alert-key]')?.dataset.alertKey;
    if (!key) return;
    this._dismissedAlerts.add(key);
    this.render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Messages
  // ═══════════════════════════════════════════════════════════

  static async _onQuickSend(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;

    const actor = game.actors.get(actorId);
    if (!actor) return;

    game.nightcity?.openComposer?.({ fromActorId: actorId, fromName: actor.name });
    log.info(`Admin: Quick-send as ${actor.name}`);
  }

  /**
   * Quick-send as NPC — handles both actor-linked and contact-only NPCs.
   */
  static _onNpcQuickSend(event, target) {
    const el = target.closest('[data-npc-id]');
    const npcId = el?.dataset.npcId;
    const contactId = el?.dataset.contactId;
    if (!npcId) return;

    // Try as actor first
    const actor = game.actors?.get(npcId);
    if (actor) {
      game.nightcity?.openComposer?.({ fromActorId: npcId, fromName: actor.name });
      log.info(`Admin: Quick-send as actor ${actor.name}`);
      return;
    }

    // Try as contact
    const contact = contactId
      ? game.nightcity?.masterContactService?.getContact(contactId)
      : game.nightcity?.masterContactService?.getContact(npcId);
    if (contact) {
      if (contact.actorId) {
        game.nightcity?.openComposer?.({ fromActorId: contact.actorId });
      } else {
        game.nightcity?.openComposer?.({
          fromContact: {
            id: contact.id,
            name: contact.name,
            email: contact.email,
            portrait: contact.portrait || null,
          },
        });
      }
      log.info(`Admin: Quick-send as contact ${contact.name}`);
    }
  }

  static _onNpcPagePrev(event, target) {
    if (this._npcSendPage > 0) this._npcSendPage--;
    this._saveScroll();
    this.render(true);
  }

  static _onNpcPageNext(event, target) {
    this._npcSendPage++;
    this._saveScroll();
    this.render(true);
  }

  static _onOpenViewInboxDialog(event, target) {
    const entries = this._gatherInboxDropdownEntries.call(this);

    // Count messages per inbox
    const inboxCounts = new Map();
    for (const journal of game.journal ?? []) {
      if (!journal.name?.startsWith('NCM-Inbox-')) continue;
      const isContact = journal.name.startsWith('NCM-Inbox-Contact-');
      const ownerId = isContact
        ? journal.name.replace('NCM-Inbox-Contact-', '')
        : journal.name.replace('NCM-Inbox-', '');
      let total = 0;
      let unread = 0;
      for (const page of journal.pages ?? []) {
        const flags = page.flags?.['cyberpunkred-messenger'];
        if (!flags) continue;
        total++;
        const isSent = (flags.messageId || '').endsWith('-sent');
        if (!flags.status?.read && !isSent && !flags.status?.deleted) unread++;
      }
      inboxCounts.set(ownerId, { total, unread });
    }

    // Build rows
    const rows = entries.map(e => {
      const counts = inboxCounts.get(e.inboxId) || { total: 0, unread: 0 };
      return { ...e, totalMessages: counts.total, unreadMessages: counts.unread };
    });

    const S = {
      panel: 'background:#1a1a2e; border:1px solid #2a2a45; border-radius:2px; padding:0; overflow:hidden;',
      search: 'display:flex; align-items:center; gap:6px; padding:7px 12px; border-bottom:1px solid #2a2a45; background:#0a0a0f;',
      scroll: 'max-height:340px; overflow-y:auto;',
      row: 'display:flex; align-items:center; gap:10px; padding:6px 12px; cursor:pointer; transition:background 0.1s; border-bottom:1px solid rgba(42,42,69,0.3);',
      pip: 'width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:Rajdhani,sans-serif; font-size:10px; font-weight:700; flex-shrink:0;',
      info: 'display:flex; flex-direction:column; flex:1; min-width:0;',
      name: 'font-family:Rajdhani,sans-serif; font-size:12px; font-weight:700; color:#e0e0e8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;',
      meta: 'font-family:Share Tech Mono,monospace; font-size:9px; color:#8888a0;',
      badge: 'font-family:Share Tech Mono,monospace; font-size:10px; flex-shrink:0; padding:2px 6px; border-radius:2px; line-height:1;',
      empty: 'padding:20px; text-align:center; font-family:Rajdhani,sans-serif; font-size:12px; color:#8888a0;',
    };

    const buildRows = (list) => {
      if (!list.length) return `<div style="${S.empty}"><i class="fas fa-inbox" style="margin-right:6px;"></i> No inboxes found</div>`;
      return list.map(e => {
        const unreadBadge = e.unreadMessages > 0
          ? `<span style="${S.badge} background:rgba(246,82,97,0.12); color:#F65261;">${e.unreadMessages} new</span>`
          : '';
        const totalBadge = `<span style="${S.badge} background:rgba(136,136,160,0.08); color:#8888a0;">${e.totalMessages}</span>`;
        return `<div class="ncm-vi-row" data-inbox-id="${e.inboxId}" style="${S.row}">
          <div style="${S.pip} color:${e.color}; border:1px solid ${e.color}33; background:${e.color}0a;">${e.initial}</div>
          <div style="${S.info}">
            <span style="${S.name}">${e.name}</span>
            <span style="${S.meta}"><i class="fas ${e.typeIcon}" style="font-size:7px; margin-right:3px;"></i>${e.type}${e.email ? ` · ${e.email}` : ''}</span>
          </div>
          ${unreadBadge}
          ${totalBadge}
        </div>`;
      }).join('');
    };

    const content = `
      <div style="font-family:Rajdhani,sans-serif; color:#eeeef4; min-width:380px;">
        <div style="${S.panel}">
          <div style="${S.search}">
            <i class="fas fa-magnifying-glass" style="font-size:9px; color:#8888a0;"></i>
            <input type="text" id="ncm-vi-search" placeholder="Search by name, email, or role…" style="flex:1; background:none; border:none; outline:none; font-family:Rajdhani,sans-serif; font-size:12px; font-weight:600; color:#e0e0e8;">
          </div>
          <div id="ncm-vi-list" style="${S.scroll}">
            ${buildRows(rows)}
          </div>
        </div>
        <div style="font-family:Share Tech Mono,monospace; font-size:9px; color:#555570; padding:6px 4px 0; text-align:center;">
          ${rows.length} inboxes · Click to open
        </div>
      </div>`;

    const dialog = new Dialog({
      title: 'View Inbox',
      content,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close',
        },
      },
      default: 'close',
      render: (html) => {
        const searchEl = html.find('#ncm-vi-search');
        const listEl = html.find('#ncm-vi-list');

        // Search filtering
        let searchTimeout;
        searchEl.on('input', () => {
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => {
            const q = searchEl.val().toLowerCase();
            const filtered = q
              ? rows.filter(e => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q) || e.type.toLowerCase().includes(q))
              : rows;
            listEl.html(buildRows(filtered));
            bindRowClicks();
          }, 200);
        });

        searchEl.focus();

        // Click to open inbox
        const bindRowClicks = () => {
          html.find('.ncm-vi-row').on('click', (e) => {
            const id = e.currentTarget.dataset.inboxId;
            if (!id) return;
            game.nightcity?.openInbox?.(id);
            dialog.close();
          });
        };
        bindRowClicks();
      },
    }, {
      width: 440,
      classes: ['ncm-time-config-dialog'],
    });

    dialog.render(true);
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

    const entry = this.schedulingService?.getScheduled?.(scheduleId);
    if (!entry) {
      ui.notifications.warn('NCM | Scheduled entry not found.');
      return;
    }

    const data = entry.messageData || {};
    const currentDelivery = entry.deliveryTime ? new Date(entry.deliveryTime) : new Date();
    const dateVal = `${currentDelivery.getUTCFullYear()}-${String(currentDelivery.getUTCMonth() + 1).padStart(2, '0')}-${String(currentDelivery.getUTCDate()).padStart(2, '0')}`;
    const timeVal = `${String(currentDelivery.getUTCHours()).padStart(2, '0')}:${String(currentDelivery.getUTCMinutes()).padStart(2, '0')}`;

    const content = `
      <div style="font-family:Rajdhani,sans-serif; color:#eeeef4;">
        <div style="background:#1a1a2e; border:1px solid #2a2a45; border-radius:2px; padding:10px 14px; margin-bottom:10px;">
          <div style="font-size:9px; font-weight:700; color:#8888a0; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Message Details</div>
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:4px;">
            <span style="font-size:12px; font-weight:700; color:#F65261;">${data.from || data.fromName || 'Unknown'}</span>
            <i class="fas fa-arrow-right" style="font-size:8px; color:#555570;"></i>
            <span style="font-size:12px; font-weight:700; color:#19f3f7;">${data.to || data.toName || 'Unknown'}</span>
          </div>
          <div style="font-size:11px; color:#c0c0d0;">"${data.subject || '(no subject)'}"</div>
        </div>
        <div style="background:#1a1a2e; border:1px solid #2a2a45; border-radius:2px; padding:10px 14px;">
          <div style="font-size:9px; font-weight:700; color:#8888a0; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px;">Reschedule Delivery</div>
          <div style="display:flex; align-items:center; gap:8px;">
            <input type="date" id="ncm-sched-edit-date" value="${dateVal}" style="background:#12121a; border:1px solid #2a2a45; color:#eeeef4; font-family:Share Tech Mono,monospace; font-size:12px; padding:5px 8px; border-radius:2px; outline:none; color-scheme:dark; flex:1;">
            <input type="time" id="ncm-sched-edit-time" value="${timeVal}" style="background:#12121a; border:1px solid #2a2a45; color:#eeeef4; font-family:Share Tech Mono,monospace; font-size:12px; padding:5px 8px; border-radius:2px; outline:none; width:100px;">
          </div>
        </div>
      </div>`;

    const dialog = new Dialog({
      title: 'Edit Scheduled Message',
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Reschedule',
          callback: async (html) => {
            const date = html.find('#ncm-sched-edit-date').val();
            const time = html.find('#ncm-sched-edit-time').val();
            if (!date || !time) return;
            const newDelivery = new Date(`${date}T${time}:00`).toISOString();
            await this.schedulingService?.editScheduled(scheduleId, { deliveryTime: newDelivery });
            ui.notifications.info('NCM | Scheduled message rescheduled.');
            this.render(true);
          },
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close',
        },
      },
      default: 'save',
    }, {
      width: 400,
      height: 'auto',
      classes: ['ncm-time-config-dialog'],
    });

    dialog.render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Messages v2
  // ═══════════════════════════════════════════════════════════

  static _onMsgFeedFilter(event, target) {
    const filter = target.dataset.filter || target.closest('[data-filter]')?.dataset.filter || 'all';
    this._msgFeedFilter = filter;
    this._msgFeedLimit = 20;
    this._saveScroll();
    this.render(true);
  }

  static _onLoadMoreMessages(event, target) {
    this._msgFeedLimit += 20;
    this._saveScroll();
    this.render(true);
  }

  static _onOpenDateRangePicker(event, target) {
    // Don't open picker if clicking the clear button
    if (event.target.closest('[data-action="clearFeedDates"]')) return;
    DateRangePicker.open({
      from: this._msgFeedDateFrom,
      to: this._msgFeedDateTo,
      title: 'Filter Messages by Date',
      onApply: (from, to) => {
        this._msgFeedDateFrom = from;
        this._msgFeedDateTo = to;
        this._msgFeedLimit = 20;
        this.render(true);
      },
      onClear: () => {
        this._msgFeedDateFrom = '';
        this._msgFeedDateTo = '';
        this._msgFeedLimit = 20;
        this.render(true);
      },
    });
  }

  static _onClearFeedDates(event, target) {
    event.stopPropagation();
    this._msgFeedDateFrom = '';
    this._msgFeedDateTo = '';
    this._msgFeedLimit = 20;
    this._saveScroll();
    this.render(true);
  }

  static _onToggleMsgExpand(event, target) {
    if (event.target.closest('[data-action]:not([data-action="toggleMsgExpand"])')) return;
    const msgId = target.closest('[data-message-id]')?.dataset.messageId;
    if (!msgId) return;
    this._expandedMessageId = (this._expandedMessageId === msgId) ? null : msgId;
    this._saveScroll();
    this.render(true);
  }

  static _onToggleMsgActorFilter(event, target) {
    if (event.target.closest('[data-action="setMsgActorFilter"]')) return;
    this._msgActorDropdownOpen = !this._msgActorDropdownOpen;
    this._saveScroll();
    this.render(true);
  }

  static _onSetMsgActorFilter(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId ?? '';
    this._msgFeedActorFilter = actorId;
    this._msgActorDropdownOpen = false;
    this._msgFeedLimit = 20;
    this._saveScroll();
    this.render(true);
  }

  static _onOpenMsgInInbox(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const inboxOwnerId = target.closest('[data-inbox-owner]')?.dataset.inboxOwner
                       || target.dataset.inboxOwner;
    const messageId = target.closest('[data-message-id]')?.dataset.messageId
                    || target.dataset.messageId;
    if (!inboxOwnerId) return;
    game.nightcity?.openInbox?.(inboxOwnerId, messageId || undefined);
  }

  static _onReplyAsMsg(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const inboxOwnerId = target.closest('[data-inbox-owner]')?.dataset.inboxOwner
                       || target.dataset.inboxOwner;
    if (!inboxOwnerId) return;
    // Open composer as the inbox owner (reply as the recipient)
    const actor = game.actors?.get(inboxOwnerId);
    if (actor) {
      game.nightcity?.openComposer?.({ fromActorId: actor.id, fromName: actor.name });
    } else {
      game.nightcity?.openComposer?.();
    }
  }

  static async _onShareMsgToChat(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const messageId = target.closest('[data-message-id]')?.dataset.messageId
                    || target.dataset.messageId;
    if (!messageId) return;

    // Find the journal page for this message
    let foundPage = null;
    for (const journal of game.journal ?? []) {
      if (!journal.name?.startsWith('NCM-Inbox-')) continue;
      for (const page of journal.pages ?? []) {
        const flags = page.flags?.['cyberpunkred-messenger'];
        if (flags?.messageId === messageId) {
          foundPage = { page, flags };
          break;
        }
      }
      if (foundPage) break;
    }

    if (!foundPage) {
      ui.notifications.warn('NCM | Message not found.');
      return;
    }

    const { flags } = foundPage;
    const bodyText = flags.body || '';
    const content = await renderTemplate(
      `modules/${MODULE_ID}/templates/chat/intercepted-message.hbs`,
      {
        from: flags.senderName || flags.from || 'Unknown',
        to: flags.recipientName || flags.to || 'Unknown',
        subject: flags.subject || '(no subject)',
        bodyPreview: bodyText.length > 200 ? bodyText.slice(0, 200) + '...' : bodyText,
        networkDisplay: flags.network || 'UNKNOWN',
      }
    );

    await ChatMessage.create({
      content,
      speaker: { alias: 'NCM // GM' },
    });

    ui.notifications.info('NCM | Message shared to chat.');
  }

  static async _onForceDeliverMsg(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const messageId = target.closest('[data-message-id]')?.dataset.messageId
                    || target.dataset.messageId;
    if (!messageId) return;

    const result = await this.messageService?.forceDeliver?.(messageId);
    if (result?.success) {
      ui.notifications.info('NCM | Message force-delivered.');
    } else {
      ui.notifications.warn('NCM | Force delivery not available or failed.');
    }
    this.render(true);
  }

  static async _onCancelQueuedMsg(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const messageId = target.closest('[data-message-id]')?.dataset.messageId
                    || target.dataset.messageId;
    if (!messageId) return;

    const result = await this.messageService?.cancelQueued?.(messageId);
    if (result?.success) {
      ui.notifications.info('NCM | Queued message cancelled.');
    } else {
      ui.notifications.warn('NCM | Cancel failed.');
    }
    this.render(true);
  }

  static async _onFlushMsgQueue(event, target) {
    event.preventDefault();
    const queue = this.messageService?.getQueue?.() ?? [];
    if (!queue.length) {
      ui.notifications.info('NCM | Queue is empty.');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: 'Force Deliver All',
      content: `<p>Force-deliver <strong>${queue.length}</strong> queued message${queue.length > 1 ? 's' : ''}? This bypasses network requirements.</p>`,
    });
    if (!confirmed) return;

    let delivered = 0;
    for (const entry of queue) {
      const result = await this.messageService?.forceDeliver?.(entry.messageId || entry.id);
      if (result?.success) delivered++;
    }
    ui.notifications.info(`NCM | Force-delivered ${delivered} message${delivered !== 1 ? 's' : ''}.`);
    this.render(true);
  }

  static async _onMarkAllRead(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;

    try {
      const messages = await this.messageService?.getMessages(actorId) ?? [];
      const unread = messages.filter(m => !m.status?.read && !m.status?.sent && !m.status?.deleted);
      if (!unread.length) {
        ui.notifications.info('NCM | No unread messages.');
        return;
      }

      for (const msg of unread) {
        await this.messageRepository?.markRead(actorId, msg.messageId || msg.id);
      }
      ui.notifications.info(`NCM | Marked ${unread.length} message${unread.length !== 1 ? 's' : ''} as read.`);
      this.render(true);
    } catch (error) {
      console.error(`${MODULE_ID} | Mark all read failed:`, error);
      ui.notifications.error('NCM | Failed to mark messages as read.');
    }
  }

  static async _onPurgeOldMessages(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;

    const actor = game.actors?.get(actorId);
    if (!actor) return;

    const confirmed = await Dialog.confirm({
      title: 'Purge Old Messages',
      content: `<p>Delete all read messages older than 7 days from <strong>${actor.name}</strong>'s inbox?</p>`,
    });
    if (!confirmed) return;

    try {
      const messages = await this.messageService?.getMessages(actorId) ?? [];
      const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
      const toPurge = messages.filter(m => {
        const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
        return m.status?.read && ts < cutoff && !m.status?.saved;
      });

      if (!toPurge.length) {
        ui.notifications.info('NCM | No old read messages to purge.');
        return;
      }

      for (const msg of toPurge) {
        await this.messageRepository?.hardDelete(msg.messageId || msg.id);
      }
      ui.notifications.info(`NCM | Purged ${toPurge.length} old message${toPurge.length !== 1 ? 's' : ''} from ${actor.name}'s inbox.`);
      this.render(true);
    } catch (error) {
      console.error(`${MODULE_ID} | Purge failed:`, error);
      ui.notifications.error('NCM | Purge failed.');
    }
  }

  static async _onMsgBroadcast(event, target) {
    // Open a dialog to compose a broadcast message to all player inboxes
    const playerActors = [];
    for (const user of game.users) {
      if (user.isGM || !user.character) continue;
      playerActors.push({ id: user.character.id, name: user.character.name });
    }

    if (!playerActors.length) {
      ui.notifications.warn('NCM | No player-owned characters found.');
      return;
    }

    const dialog = new Dialog({
      title: 'Mass Broadcast — All Player Inboxes',
      content: `
        <form style="display:flex; flex-direction:column; gap:8px; padding:4px 0;">
          <label style="font-size:11px; font-weight:600;">From (NPC / Sender name)</label>
          <input type="text" name="from" placeholder="e.g. NCPD, System, Rogue…" style="padding:6px 8px; font-size:12px;">
          <label style="font-size:11px; font-weight:600;">Subject</label>
          <input type="text" name="subject" placeholder="Message subject…" style="padding:6px 8px; font-size:12px;">
          <label style="font-size:11px; font-weight:600;">Message Body</label>
          <textarea name="body" rows="4" placeholder="Message content…" style="padding:6px 8px; font-size:12px; resize:vertical;"></textarea>
          <p style="font-size:10px; color:#888; margin:0;">Will be delivered to ${playerActors.length} player inbox${playerActors.length !== 1 ? 'es' : ''}: ${playerActors.map(a => a.name).join(', ')}</p>
        </form>`,
      buttons: {
        send: {
          icon: '<i class="fas fa-tower-broadcast"></i>',
          label: 'Send Broadcast',
          callback: async (html) => {
            const from = html.find('[name="from"]').val()?.trim() || 'System';
            const subject = html.find('[name="subject"]').val()?.trim() || 'Broadcast';
            const body = html.find('[name="body"]').val()?.trim();
            if (!body) return;

            let sent = 0;
            for (const pa of playerActors) {
              try {
                await this.messageService?.sendMessage({
                  from,
                  to: pa.name,
                  toActorId: pa.id,
                  subject,
                  body,
                  isBroadcast: true,
                });
                sent++;
              } catch { /* continue */ }
            }
            ui.notifications.info(`NCM | Broadcast sent to ${sent} player inbox${sent !== 1 ? 'es' : ''}.`);
            this.render(true);
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
      },
      default: 'send',
    });
    dialog.render(true);
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
        // Save scroll before re-render
    const content = this.element?.querySelector('.ncm-admin-content');
    if (content) this._scrollPositions[this._activeTab] = content.scrollTop;
    this.render(true);
  }

  /**
   * Clear the contact search input.
   */
  static _onContactClearSearch(event, target) {
    this._contactSearch = '';
        // Save scroll before re-render
    const content = this.element?.querySelector('.ncm-admin-content');
    if (content) this._scrollPositions[this._activeTab] = content.scrollTop;
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
    // Save scroll before re-render
    const content = this.element?.querySelector('.ncm-admin-content');
    if (content) this._scrollPositions[this._activeTab] = content.scrollTop;
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
        // Save scroll before re-render
    const content = this.element?.querySelector('.ncm-admin-content');
    if (content) this._scrollPositions[this._activeTab] = content.scrollTop;
    this.render(true);
  }

  /**
   * Clear all contact selections.
   */
  static _onClearContactSelection() {
    this._selectedContacts.clear();
        // Save scroll before re-render
    const content = this.element?.querySelector('.ncm-admin-content');
    if (content) this._scrollPositions[this._activeTab] = content.scrollTop;
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
        // Save scroll before re-render
    const content = this.element?.querySelector('.ncm-admin-content');
    if (content) this._scrollPositions[this._activeTab] = content.scrollTop;
    this.render(true);
  }

  /**
   * Toggle the overflow menu.
   */
  static _onToggleContactOverflow(event, target) {
    event.preventDefault();
    event.stopPropagation();
    this._contactOverflowOpen = !this._contactOverflowOpen;
        // Save scroll before re-render
    const content = this.element?.querySelector('.ncm-admin-content');
    if (content) this._scrollPositions[this._activeTab] = content.scrollTop;
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

  /**
   * Open a contact's inbox and navigate to a specific message.
   */
  static _onOpenRecentMessage(event, target) {
    event.preventDefault();
    event.stopPropagation();

    const msgEl = target.closest('.ncm-ct-detail__msg');
    if (!msgEl) return;

    const inboxOwnerId = msgEl.dataset.inboxOwner;
    const messageId = msgEl.dataset.messageId;

    if (!inboxOwnerId) return;

    // openInbox handles singleton window, actor switching, and message selection
    game.nightcity?.openInbox?.(inboxOwnerId, messageId || undefined);
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

  static _onCreateNetwork(event, target) {
    game.nightcity?.openNetworkManagerToCreate?.();
    log.info('Admin: Opening Network Manager → Create mode');
  }

  static async _onDeleteNetwork(event, target) {
    const networkId = target.dataset.networkId || target.closest('[data-network-id]')?.dataset.networkId;
    if (!networkId) return;
    const net = this.networkService?.getNetwork(networkId);
    if (!net) return;
    if (net.isCore) {
      ui.notifications.warn('NCM | Core networks cannot be deleted.');
      return;
    }
    const confirm = await Dialog.confirm({
      title: 'Delete Network',
      content: `<p>Delete <strong>${net.name}</strong>? This cannot be undone.</p>`,
    });
    if (!confirm) return;
    await this.networkService?.deleteNetwork(networkId);
    ui.notifications.info(`NCM | Network "${net.name}" deleted.`);
    this.render(true);
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
    this._pendingContentScrollReset = true;
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

  /**
   * Open the message or shard referenced by a log entry link.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  static _onOpenLogReference(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const linkEl = target.closest('[data-link-type]') ?? target;
    const linkType = linkEl.dataset.linkType;
    const messageId = linkEl.dataset.messageId;
    const actorId = linkEl.dataset.actorId;
    const itemId = linkEl.dataset.itemId;

    if (linkType === 'message' && messageId && actorId) {
      // Open the message viewer for this actor, focused on this message
      game.nightcity?.messenger?.openInbox?.(actorId, { messageId });
    } else if (linkType === 'shard' && itemId) {
      // Find and open the shard
      const item = AdminPanelApp._findItem(itemId);
      if (item) {
        game.nightcity?.messenger?.forceOpenDataShard?.(item);
      } else {
        ui.notifications.warn('NCM | Could not find the referenced data shard.');
      }
    }
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
    const form = target.closest('.ncm-actlog__add-form') || this.element?.querySelector('.ncm-actlog__add-form');
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

    const content = await renderTemplate(
      `modules/${MODULE_ID}/templates/chat/network-broadcast.hbs`,
      {
        networkName,
        message: foundry.utils.encodeHTML ? foundry.utils.encodeHTML(message) : message,
      }
    );

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

    // Use the shard viewer if it's a data shard, otherwise fall back to default sheet
    if (item.getFlag(MODULE_ID, 'isDataShard') && game.nightcity?.openDataShard) {
      game.nightcity.openDataShard(item);
    } else {
      item.sheet.render(true);
    }
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

    try {
      this._animationActive = true;
      const result = await game.nightcity?.dataShardService?.relockShard(item);
      this._animationActive = false;
      if (result?.success) {
        ui.notifications.info(`NCM | Relocked: ${item.name}`);
      } else {
        ui.notifications.error(`NCM | Relock failed: ${result?.error || 'Unknown'}`);
      }
    } catch (err) {
      this._animationActive = false;
      console.error(`${MODULE_ID} | relockShard failed:`, err);
      ui.notifications.error(`NCM | Relock failed: ${err.message}`);
    }
    this.render(true);
  }

  static async _onConvertItem(event, target) {
    const candidates = [];
    const seenIds = new Set();
    const types = new Set();
    const sources = new Map(); // source name → count

    for (const item of (game.items ?? [])) {
      if (item.getFlag(MODULE_ID, 'isDataShard')) continue;
      candidates.push({ id: item.id, name: item.name, type: item.type, source: 'World', uuid: item.uuid, img: item.img });
      seenIds.add(item.id);
      types.add(item.type);
      sources.set('World', (sources.get('World') || 0) + 1);
    }
    for (const actor of (game.actors ?? [])) {
      for (const item of actor.items) {
        if (seenIds.has(item.id) || item.getFlag(MODULE_ID, 'isDataShard')) continue;
        candidates.push({ id: item.id, name: item.name, type: item.type, source: actor.name, uuid: item.uuid, img: item.img });
        types.add(item.type);
        sources.set(actor.name, (sources.get(actor.name) || 0) + 1);
      }
    }

    if (!candidates.length) {
      ui.notifications.warn('NCM | No unconverted items found. Create an item first.');
      return;
    }

    candidates.sort((a, b) => a.name.localeCompare(b.name));
    const typeOpts = [...types].sort().map(t => `<option value="${t}">${t}</option>`).join('');
    const tabsHtml = [
      `<button class="ncm-pick__tab ncm-pick__tab--active" data-source="">All<span class="ncm-pick__tab-count">${candidates.length}</span></button>`,
      ...[...sources.entries()].map(([name, count]) =>
        `<button class="ncm-pick__tab" data-source="${name}">${name}<span class="ncm-pick__tab-count">${count}</span></button>`
      ),
    ].join('');

    const uuid = await new Promise(resolve => {
      new Dialog({
        title: 'Convert Item to Data Shard',
        content: `
          <div class="ncm-pick__controls">
            <div class="ncm-pick__search-wrap">
              <i class="fas fa-search"></i>
              <input type="text" class="ncm-pick__search" id="ncm-pick-search" placeholder="Search items..." autocomplete="off">
            </div>
            <select class="ncm-pick__filter" id="ncm-pick-type"><option value="">All types</option>${typeOpts}</select>
          </div>
          <div class="ncm-pick__tabs" id="ncm-pick-tabs">${tabsHtml}</div>
          <div class="ncm-pick__list" id="ncm-pick-list">
            ${candidates.map(c => `
              <div class="ncm-pick__item" data-uuid="${c.uuid}" data-name="${c.name.toLowerCase()}" data-type="${c.type}" data-source="${c.source}">
                <img class="ncm-pick__item-img" src="${c.img || 'icons/svg/item-bag.svg'}" width="30" height="30">
                <div style="flex:1;min-width:0;">
                  <div class="ncm-pick__item-name">${c.name}</div>
                  <div class="ncm-pick__item-meta">${c.source}</div>
                </div>
                <span class="ncm-pick__item-type">${c.type}</span>
              </div>
            `).join('')}
          </div>
          <div class="ncm-pick__count" id="ncm-pick-count">${candidates.length} items</div>`,
        buttons: {
          convert: { label: '<i class="fas fa-microchip"></i> Convert', callback: html => {
            const sel = html[0].querySelector('.ncm-pick__item--selected');
            resolve(sel?.dataset.uuid || null);
          }},
          cancel: { label: 'Cancel', callback: () => resolve(null) },
        },
        default: 'convert',
        render: html => {
          const root = html[0] ?? html;
          const search = root.querySelector('#ncm-pick-search');
          const typeFilter = root.querySelector('#ncm-pick-type');
          const tabs = root.querySelector('#ncm-pick-tabs');
          const list = root.querySelector('#ncm-pick-list');
          const count = root.querySelector('#ncm-pick-count');
          let activeSource = '';

          const filter = () => {
            const q = search.value.toLowerCase();
            const t = typeFilter.value;
            let visible = 0;
            list.querySelectorAll('.ncm-pick__item').forEach(el => {
              const nameMatch = !q || el.dataset.name.includes(q);
              const typeMatch = !t || el.dataset.type === t;
              const sourceMatch = !activeSource || el.dataset.source === activeSource;
              const show = nameMatch && typeMatch && sourceMatch;
              el.dataset.hidden = !show;
              if (show) visible++;
            });
            count.textContent = `${visible} item${visible !== 1 ? 's' : ''}`;
          };

          search.addEventListener('input', filter);
          typeFilter.addEventListener('change', filter);
          tabs.addEventListener('click', (ev) => {
            const tab = ev.target.closest('.ncm-pick__tab');
            if (!tab) return;
            tabs.querySelectorAll('.ncm-pick__tab').forEach(t => t.classList.remove('ncm-pick__tab--active'));
            tab.classList.add('ncm-pick__tab--active');
            activeSource = tab.dataset.source;
            filter();
          });
          list.addEventListener('click', (ev) => {
            const el = ev.target.closest('.ncm-pick__item');
            if (!el) return;
            list.querySelectorAll('.ncm-pick__item--selected').forEach(s => s.classList.remove('ncm-pick__item--selected'));
            el.classList.add('ncm-pick__item--selected');
          });
          list.addEventListener('dblclick', (ev) => {
            const el = ev.target.closest('.ncm-pick__item');
            if (el) { el.classList.add('ncm-pick__item--selected'); root.closest('.dialog')?.querySelector('[data-button="convert"]')?.click(); }
          });
          search.focus();
        },
      }, { width: 440, classes: ['ncm-pick-dialog'] }).render(true);
    });

    if (!uuid) return;
    const item = await fromUuid(uuid);
    if (!item) { ui.notifications.error('NCM | Item not found.'); return; }

    const result = await game.nightcity?.dataShardService?.convertToDataShard(item);
    if (result?.success) {
      ui.notifications.info(`NCM | "${item.name}" converted to data shard.`);
      ui.items?.render();
      this.render();
    } else {
      ui.notifications.error(`NCM | Failed: ${result?.error || 'Unknown error'}`);
    }
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

    try {
      this._animationActive = true;
      for (const item of shards) {
        await this.dataShardService?.relockShard(item);
      }
      this._animationActive = false;
    } catch (err) {
      this._animationActive = false;
      console.error(`${MODULE_ID} | bulkRelockAll failed:`, err);
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
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    const item = AdminPanelApp._findItem(itemId);
    if (!item) return;

    try {
      this._animationActive = true;
      const result = await game.nightcity?.dataShardService?.relockShard(item);
      this._animationActive = false;
      if (result?.success) {
        ui.notifications.info(`NCM | Relocked: ${item.name}`);
      } else {
        ui.notifications.error(`NCM | Relock failed: ${result?.error || 'Unknown'}`);
      }
    } catch (err) {
      this._animationActive = false;
      console.error(`${MODULE_ID} | relockShardItem failed:`, err);
      ui.notifications.error(`NCM | Relock failed: ${err.message}`);
    }
    this.render();
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

    let item;
    if (itemId) {
      item = AdminPanelApp._findItem(itemId);
    } else {
      const shards = AdminPanelApp._getAllDataShards();
      if (!shards.length) {
        ui.notifications.warn('NCM | No data shards to unconvert.');
        return;
      }

      const pickedId = await new Promise(resolve => {
        new Dialog({
          title: 'Unconvert Data Shard',
          content: `
            <div class="ncm-pick--danger">
              <div class="ncm-pick__controls">
                <div class="ncm-pick__search-wrap">
                  <i class="fas fa-search"></i>
                  <input type="text" class="ncm-pick__search" id="ncm-pick-search" placeholder="Search shards..." autocomplete="off">
                </div>
              </div>
              <div class="ncm-pick__list" id="ncm-pick-list">
                ${shards.map(s => {
                  const config = s.getFlag(MODULE_ID, 'config') || {};
                  const preset = config.preset || 'default';
                  const encrypted = config.encrypted || false;
                  const iceType = config.iceType || (encrypted ? 'ICE' : '');
                  const state = s.getFlag(MODULE_ID, 'state') || {};
                  const isOpen = state.decrypted || !encrypted;
                  let badgeHtml = '';
                  if (iceType === 'BLACK_ICE' || iceType === 'black') {
                    badgeHtml = '<span class="ncm-pick__shard-badge ncm-pick__shard-badge--ice"><i class="fas fa-skull"></i> BLACK</span>';
                  } else if (encrypted) {
                    badgeHtml = '<span class="ncm-pick__shard-badge ncm-pick__shard-badge--ice"><i class="fas fa-shield-halved"></i> ICE</span>';
                  } else {
                    badgeHtml = '<span class="ncm-pick__shard-badge ncm-pick__shard-badge--open"><i class="fas fa-unlock"></i> Open</span>';
                  }
                  return `<div class="ncm-pick__item" data-id="${s.id}" data-name="${s.name.toLowerCase()}">
                    <img class="ncm-pick__item-img" src="${s.img || 'icons/svg/item-bag.svg'}" width="30" height="30">
                    <div style="flex:1;min-width:0;">
                      <div class="ncm-pick__item-name">${s.name}</div>
                      <div class="ncm-pick__item-meta">${s.type} · ${preset}</div>
                    </div>
                    ${badgeHtml}
                  </div>`;
                }).join('')}
              </div>
              <div class="ncm-pick__warning">
                <i class="fas fa-exclamation-triangle"></i>
                <span>Shard content, ICE, boot sequence, and configuration will be permanently removed. The base item is preserved.</span>
              </div>
            </div>`,
          buttons: {
            unconvert: { label: '<i class="fas fa-rotate-left"></i> Unconvert', callback: html => {
              const sel = html[0].querySelector('.ncm-pick__item--selected');
              resolve(sel?.dataset.id || null);
            }},
            cancel: { label: 'Cancel', callback: () => resolve(null) },
          },
          default: 'unconvert',
          render: html => {
            const root = html[0] ?? html;
            const search = root.querySelector('#ncm-pick-search');
            const list = root.querySelector('#ncm-pick-list');

            search.addEventListener('input', () => {
              const q = search.value.toLowerCase();
              list.querySelectorAll('.ncm-pick__item').forEach(el => {
                el.dataset.hidden = q && !el.dataset.name.includes(q);
              });
            });
            list.addEventListener('click', (ev) => {
              const el = ev.target.closest('.ncm-pick__item');
              if (!el) return;
              list.querySelectorAll('.ncm-pick__item--selected').forEach(s => s.classList.remove('ncm-pick__item--selected'));
              el.classList.add('ncm-pick__item--selected');
            });
            search.focus();
          },
        }, { width: 400, classes: ['ncm-pick-dialog'] }).render(true);
      });

      if (!pickedId) return;
      item = AdminPanelApp._findItem(pickedId);
    }

    if (!item) return;

    const confirmed = await Dialog.confirm({
      title: 'Unconvert Data Shard',
      content: `<p>Remove all data shard flags from <strong>${item.name}</strong>? The item will revert to a normal item. Shard entries and journal data will be preserved but detached.</p>`,
    });
    if (!confirmed) return;

    await item.unsetFlag(MODULE_ID, 'isDataShard');
    await item.unsetFlag(MODULE_ID, 'config');
    await item.unsetFlag(MODULE_ID, 'state');

    ui.notifications.info(`NCM | Unconverted: ${item.name} is now a regular item.`);
    ui.items?.render();
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
    if (!item) {
      console.warn(`${MODULE_ID} | toggleShardLayer: item ${itemId} not found`);
      return;
    }

    const state = item.getFlag(MODULE_ID, 'state') ?? {};
    const sessions = foundry.utils.deepClone(state.sessions ?? {});

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

    const confirmed = await Dialog.confirm({
      title: `${isCleared ? 'Relock' : 'Unlock'} Security Layer`,
      content: `<p>${isCleared ? 'Relock' : 'Force-clear'} the <strong>${layer}</strong> layer on <strong>${item.name}</strong>?${isCleared ? ' All layers from this point forward will also be relocked.' : ''}</p>`,
    });
    if (!confirmed) return;

    const LAYER_ORDER = ['network', 'keyitem', 'login', 'encryption'];
    const layerIdx = LAYER_ORDER.indexOf(layer);

    // Build the complete new state object
    const newState = foundry.utils.deepClone(state);

    if (isCleared) {
      // RELOCK from this layer forward
      for (const [actorId, session] of Object.entries(newState.sessions ?? {})) {
        const hackedLayers = [...(session.hackedLayers || [])];
        for (let i = layerIdx; i < LAYER_ORDER.length; i++) {
          const l = LAYER_ORDER[i];
          const hIdx = hackedLayers.indexOf(l);
          if (hIdx !== -1) hackedLayers.splice(hIdx, 1);
          if (l === 'keyitem') session.keyItemUsed = false;
          if (l === 'login') session.loggedIn = false;
        }
        session.hackedLayers = hackedLayers;
      }
      if (layerIdx <= LAYER_ORDER.indexOf('encryption')) {
        newState.decrypted = false;
        newState.gmBypassed = false;
      }
    } else {
      // UNLOCK up to and including this layer
      if (!newState.sessions) newState.sessions = {};
      const gmSession = newState.sessions['gm-override']
        || { hackedLayers: [], hackAttempts: 0, loggedIn: false, keyItemUsed: false, keyItemAttempts: 0, loginAttempts: 0, layerHackAttempts: {}, layerLockoutUntil: null, lockoutUntil: null };
      const hackedLayers = [...(gmSession.hackedLayers || [])];
      for (let i = 0; i <= layerIdx; i++) {
        const l = LAYER_ORDER[i];
        if (!hackedLayers.includes(l)) hackedLayers.push(l);
        if (l === 'keyitem') gmSession.keyItemUsed = true;
        if (l === 'login') gmSession.loggedIn = true;
      }
      gmSession.hackedLayers = hackedLayers;
      newState.sessions['gm-override'] = gmSession;
      if (layer === 'encryption') {
        newState.decrypted = true;
        newState.gmBypassed = true;
      }
    }

    try {
      // Suppress debounced re-renders during the two-step flag write
      this._animationActive = true;
      await item.unsetFlag(MODULE_ID, 'state');
      await item.setFlag(MODULE_ID, 'state', newState);
      this._animationActive = false;

      const verb = isCleared ? 'Relocked' : 'Force-cleared';
      ui.notifications.info(`NCM | ${verb} ${item.name} ${isCleared ? 'from' : 'through'} ${layer} layer.`);
    } catch (err) {
      this._animationActive = false;
      console.error(`${MODULE_ID} | toggleShardLayer failed:`, err);
      ui.notifications.error(`NCM | Layer toggle failed: ${err.message}`);
    }
    this.render();
  }

  static async _onForceDecryptShardItem(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    const item = AdminPanelApp._findItem(itemId);
    if (!item) {
      console.warn(`${MODULE_ID} | forceDecryptShardItem: item ${itemId} not found`);
      return;
    }

    const state = item.getFlag(MODULE_ID, 'state') ?? {};
    if (state.decrypted) {
      // Already decrypted → relock (delegates to DataShardService which uses unsetFlag/setFlag)
      try {
        this._animationActive = true;
        const result = await game.nightcity?.dataShardService?.relockShard(item);
        this._animationActive = false;
        if (result?.success) {
          ui.notifications.info(`NCM | Relocked: ${item.name}`);
        } else {
          ui.notifications.error(`NCM | Relock failed: ${result?.error || 'Unknown'}`);
        }
      } catch (err) {
        this._animationActive = false;
        console.error(`${MODULE_ID} | forceDecryptShardItem relock failed:`, err);
        ui.notifications.error(`NCM | Relock failed: ${err.message}`);
      }
    } else {
      // Locked → force decrypt via atomic unset/set
      try {
        const newState = foundry.utils.deepClone(state);
        newState.decrypted = true;
        newState.gmBypassed = true;
        // Create a GM override session that has all layers cleared
        if (!newState.sessions) newState.sessions = {};
        const config = item.getFlag(MODULE_ID, 'config') ?? {};
        const gmSession = newState.sessions['gm-override']
          || { hackedLayers: [], hackAttempts: 0, loggedIn: false, keyItemUsed: false, keyItemAttempts: 0, loginAttempts: 0, layerHackAttempts: {}, layerLockoutUntil: null, lockoutUntil: null };
        // Mark all configured layers as cleared
        const allLayers = [];
        const netConfig = config.network ?? {};
        if (netConfig.required ?? config.requiresNetwork) allLayers.push('network');
        if (config.requiresKeyItem) allLayers.push('keyitem');
        if (config.requiresLogin) allLayers.push('login');
        if (config.encrypted) allLayers.push('encryption');
        gmSession.hackedLayers = allLayers;
        if (allLayers.includes('keyitem')) gmSession.keyItemUsed = true;
        if (allLayers.includes('login')) gmSession.loggedIn = true;
        newState.sessions['gm-override'] = gmSession;

        this._animationActive = true;
        await item.unsetFlag(MODULE_ID, 'state');
        await item.setFlag(MODULE_ID, 'state', newState);
        this._animationActive = false;
        ui.notifications.info(`NCM | Force-decrypted: ${item.name}`);
      } catch (err) {
        this._animationActive = false;
        console.error(`${MODULE_ID} | forceDecryptShardItem decrypt failed:`, err);
        ui.notifications.error(`NCM | Force-decrypt failed: ${err.message}`);
      }
    }
    this.render();
  }

  // ─── Shard Integrity Handlers ───

  /**
   * Set shard integrity to a specific value from a data-value attribute.
   * Used by the preset buttons (100, 75, 50, 25, 0).
   */
  static async _onSetShardIntegrity(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    const value = parseInt(target.closest('[data-value]')?.dataset.value);
    if (!itemId || isNaN(value)) return;

    const item = AdminPanelApp._findItem(itemId);
    if (!item) return;

    try {
      this._animationActive = true;
      const result = await game.nightcity?.dataShardService?.setIntegrity(item, value);
      this._animationActive = false;
      if (result?.success) {
        ui.notifications.info(`NCM | ${item.name} integrity set to ${value}%${result.uncorruptedCount ? ` (${result.uncorruptedCount} entries restored)` : ''}`);
      } else {
        ui.notifications.warn(`NCM | Set integrity failed: ${result?.error || 'Unknown'}`);
      }
    } catch (err) {
      this._animationActive = false;
      console.error(`${MODULE_ID} | setShardIntegrity failed:`, err);
      ui.notifications.error(`NCM | Set integrity failed: ${err.message}`);
    }
    this.render();
  }

  /**
   * Restore shard integrity to max (100) — convenience shortcut.
   */
  static async _onRestoreShardIntegrity(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;

    const item = AdminPanelApp._findItem(itemId);
    if (!item) return;

    try {
      this._animationActive = true;
      const result = await game.nightcity?.dataShardService?.setIntegrity(item, 100, { uncorrupt: true });
      this._animationActive = false;
      if (result?.success) {
        ui.notifications.info(`NCM | ${item.name} integrity fully restored${result.uncorruptedCount ? ` (${result.uncorruptedCount} entries un-corrupted)` : ''}`);
      } else {
        ui.notifications.warn(`NCM | Restore failed: ${result?.error || 'Unknown'}`);
      }
    } catch (err) {
      this._animationActive = false;
      console.error(`${MODULE_ID} | restoreShardIntegrity failed:`, err);
      ui.notifications.error(`NCM | Restore failed: ${err.message}`);
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
    const ts = game.nightcity?.timeService;
    if (!ts) {
      ui.notifications.warn('NCM | TimeService not available.');
      return;
    }

    const info = ts.getProviderInfo();
    const currentTime = info.currentTime;
    const currentDate = currentTime ? new Date(currentTime) : new Date();
    let initFormat = '24H';
    try { initFormat = game.settings.get(MODULE_ID, 'timeFormat') === '12h' ? '12H' : '24H'; } catch { /* default */ }
    let initDateFmt = 'YMD';
    try { initDateFmt = game.settings.get(MODULE_ID, 'dateFormat') || 'YMD'; } catch { /* default */ }
    const dateFmtLabels = { YMD: 'Y.M.D', DMY: 'D.M.Y', MDY: 'M.D.Y' };

    // Pre-fill date/time inputs
    const dateVal = `${currentDate.getUTCFullYear()}-${String(currentDate.getUTCMonth() + 1).padStart(2, '0')}-${String(currentDate.getUTCDate()).padStart(2, '0')}`;
    const timeVal = `${String(currentDate.getUTCHours()).padStart(2, '0')}:${String(currentDate.getUTCMinutes()).padStart(2, '0')}`;

    // Pre-fill disguised with a Night City date if not already set
    let disDateVal = '2045-03-18';
    let disTimeVal = '22:00';
    try {
      const existing = game.settings.get(MODULE_ID, 'disguisedBaseTime');
      if (existing) {
        const d = new Date(existing);
        disDateVal = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        disTimeVal = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      }
    } catch { /* use defaults */ }

    // Status badges
    const scBadge = info.hasSimpleCalendar
      ? '<span style="color:#00ff41;">● Detected</span>'
      : '<span style="color:#555570;">○ Not found</span>';
    const stBadge = info.hasSmallTime
      ? '<span style="color:#00ff41;">● Detected</span>'
      : '<span style="color:#555570;">○ Not found</span>';

    // Shared styles
    const S = {
      panel: 'background:#1a1a2e; border:1px solid #2a2a45; border-radius:2px; padding:10px 14px; margin-bottom:10px;',
      label: 'font-family:Rajdhani,sans-serif; font-size:10px; font-weight:700; color:#8888a0; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;',
      value: 'font-family:Share Tech Mono,monospace; font-size:13px; color:#eeeef4;',
      monoSm: 'font-family:Share Tech Mono,monospace; font-size:10px; color:#8888a0;',
      row: 'display:flex; align-items:center; gap:10px; margin-bottom:6px;',
      input: 'background:#12121a; border:1px solid #2a2a45; color:#eeeef4; font-family:Share Tech Mono,monospace; font-size:12px; padding:5px 8px; border-radius:2px; outline:none;',
      select: 'background:#12121a; border:1px solid #2a2a45; color:#eeeef4; font-family:Rajdhani,sans-serif; font-size:13px; font-weight:600; padding:5px 8px; border-radius:2px; width:100%; outline:none;',
      btn: 'background:transparent; border:1px solid #2a2a45; color:#8888a0; font-family:Rajdhani,sans-serif; font-size:11px; font-weight:700; text-transform:uppercase; padding:5px 14px; border-radius:2px; cursor:pointer; transition:all 0.15s;',
      btnCyan: 'border-color:rgba(25,243,247,0.3); color:#19f3f7;',
      btnGold: 'border-color:rgba(247,201,72,0.3); color:#f7c948;',
      sep: 'height:1px; background:#2a2a45; margin:10px 0;',
      hint: 'font-family:Rajdhani,sans-serif; font-size:10px; font-weight:500; color:#6a6a88; margin-top:2px; line-height:1.4;',
    };

    const content = `
      <div style="font-family:Rajdhani,sans-serif; color:#eeeef4; min-width:380px;">

        <!-- Status Panel -->
        <div style="${S.panel}">
          <div style="${S.row}">
            <div style="flex:1;">
              <div style="${S.label}">Current Mode</div>
              <div style="${S.value}">${info.label}${info.isAuto ? ` <span style="color:#19f3f7;">→ ${info.effectiveLabel}</span>` : ''}</div>
            </div>
            <div style="flex:1;">
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <div style="${S.label} margin-bottom:0;">Current Time</div>
                <div style="display:flex; gap:4px;">
                  <button id="ncm-tc-datefmt-toggle" style="${S.btn} font-size:9px !important; padding:2px 8px !important;"><i class="fas fa-calendar-days" style="font-size:7px;"></i> <span id="ncm-tc-datefmt-label">${dateFmtLabels[initDateFmt]}</span></button>
                  <button id="ncm-tc-12h-toggle" style="${S.btn} font-size:9px !important; padding:2px 8px !important;"><i class="fas fa-clock" style="font-size:7px;"></i> <span id="ncm-tc-12h-label">${initFormat}</span></button>
                </div>
              </div>
              <div style="${S.value}" id="ncm-tc-clock">—</div>
            </div>
          </div>
          <div style="${S.sep}"></div>
          <div style="${S.row} margin-bottom:0;">
            <div style="flex:1;">
              <div style="${S.monoSm}"><i class="fas fa-calendar" style="font-size:8px; margin-right:4px;"></i> SimpleCalendar: ${scBadge}</div>
            </div>
            <div style="flex:1;">
              <div style="${S.monoSm}"><i class="fas fa-clock" style="font-size:8px; margin-right:4px;"></i> SmallTime: ${stBadge}</div>
            </div>
          </div>
        </div>

        <!-- Mode Selector -->
        <div style="${S.panel}">
          <div style="${S.label}">Time Provider</div>
          <select id="ncm-tc-mode" style="${S.select}">
            <option value="auto" ${info.mode === 'auto' ? 'selected' : ''}>Auto-Detect (recommended)</option>
            <option value="simple-calendar" ${info.mode === 'simple-calendar' ? 'selected' : ''} ${!info.hasSimpleCalendar ? 'disabled' : ''}>SimpleCalendar${!info.hasSimpleCalendar ? ' (not installed)' : ''}</option>
            <option value="world-time" ${info.mode === 'world-time' ? 'selected' : ''}>Foundry World Time${info.hasSmallTime ? ' (SmallTime)' : ''}</option>
            <option value="real-time" ${info.mode === 'real-time' ? 'selected' : ''}>Real-World Time</option>
            <option value="manual" ${info.mode === 'manual' ? 'selected' : ''}>Manual (GM Set)</option>
            <option value="disguised" ${info.mode === 'disguised' ? 'selected' : ''}>Disguised Time</option>
          </select>
          <div style="${S.hint}" id="ncm-tc-hint">Select how NCM determines in-game time.</div>
        </div>

        <!-- Disguised Time Config -->
        <div id="ncm-tc-disguised" style="${S.panel} ${info.mode === 'disguised' ? '' : 'display:none;'}">
          <div style="${S.label}"><i class="fas fa-masks-theater" style="font-size:9px; margin-right:4px; color:#f7c948;"></i> Disguised Time — Set Fictional Date</div>
          <div style="${S.hint} margin-bottom:8px;">The clock ticks in real-time but displays your chosen date. Set your Night City date and hit "Anchor" — the clock starts ticking from there.</div>
          <div style="${S.row}">
            <input type="date" id="ncm-tc-dis-date" value="${disDateVal}" style="${S.input} flex:1;">
            <input type="time" id="ncm-tc-dis-time" value="${disTimeVal}" style="${S.input} width:100px;">
            <button id="ncm-tc-dis-set" style="${S.btn} ${S.btnGold}"><i class="fas fa-anchor" style="font-size:9px;"></i> Anchor</button>
          </div>
          <div id="ncm-tc-dis-preview" style="border:1px solid #2a2a45; border-radius:2px; overflow:hidden; margin-bottom:8px;">
            <div style="display:flex; gap:0;">
              <div style="flex:1; padding:8px 12px; background:#12121a;">
                <div style="font-family:Share Tech Mono,monospace; font-size:9px; color:#8888a0; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:4px;"><i class="fas fa-globe" style="font-size:7px; margin-right:3px;"></i> Real World</div>
                <div id="ncm-tc-dis-real" style="font-family:Share Tech Mono,monospace; font-size:14px; color:#8888a0; line-height:1.2;">—</div>
              </div>
              <div style="width:1px; background:#2a2a45;"></div>
              <div style="flex:1; padding:8px 12px; background:rgba(247,201,72,0.02);">
                <div style="font-family:Share Tech Mono,monospace; font-size:9px; color:#f7c948; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:4px;"><i class="fas fa-city" style="font-size:7px; margin-right:3px;"></i> Night City Time</div>
                <div id="ncm-tc-dis-fake" style="font-family:Share Tech Mono,monospace; font-size:14px; color:#f7c948; line-height:1.2;">—</div>
              </div>
            </div>
          </div>
          <div style="${S.row} margin-bottom:0;">
            <button id="ncm-tc-dis-reanchor" style="${S.btn}"><i class="fas fa-rotate" style="font-size:9px;"></i> Re-Anchor Now</button>
            <div style="${S.hint} flex:1; margin-top:0;">Freezes current displayed time and restarts the clock from there. Use after session breaks.</div>
          </div>
        </div>

        <!-- Manual Time Config -->
        <div id="ncm-tc-manual" style="${S.panel} ${info.mode === 'manual' ? '' : 'display:none;'}">
          <div style="${S.label}"><i class="fas fa-hand" style="font-size:9px; margin-right:4px; color:#19f3f7;"></i> Manual Time — GM Controls</div>
          <div style="${S.hint} margin-bottom:8px;">Time only changes when you change it. Set a specific date/time or advance by increments.</div>
          <div style="${S.row}">
            <input type="date" id="ncm-tc-man-date" value="${dateVal}" style="${S.input} flex:1;">
            <input type="time" id="ncm-tc-man-time" value="${timeVal}" style="${S.input} width:100px;">
            <button id="ncm-tc-man-set" style="${S.btn} ${S.btnCyan}"><i class="fas fa-clock" style="font-size:9px;"></i> Set</button>
          </div>
          <div style="${S.label} margin-top:6px;">Quick Advance</div>
          <div style="${S.row} margin-bottom:0; gap:6px; flex-wrap:wrap;">
            <button class="ncm-tc-advance" data-seconds="60" style="${S.btn}">+1 min</button>
            <button class="ncm-tc-advance" data-seconds="300" style="${S.btn}">+5 min</button>
            <button class="ncm-tc-advance" data-seconds="1800" style="${S.btn}">+30 min</button>
            <button class="ncm-tc-advance" data-seconds="3600" style="${S.btn}">+1 hr</button>
            <button class="ncm-tc-advance" data-seconds="21600" style="${S.btn}">+6 hr</button>
            <button class="ncm-tc-advance" data-seconds="86400" style="${S.btn}">+1 day</button>
          </div>
        </div>

      </div>`;

    const dialog = new Dialog({
      title: 'NCM Time Configuration',
      content,
      buttons: {
        apply: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Apply Mode',
          callback: async (html) => {
            const mode = html.find('#ncm-tc-mode').val();
            await ts.setMode(mode);
            this.render(true);
          },
        },
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close',
        },
      },
      default: 'apply',
      render: (html) => {
        const modeSelect = html.find('#ncm-tc-mode');
        const disguisedPanel = html.find('#ncm-tc-disguised');
        const manualPanel = html.find('#ncm-tc-manual');
        const hintEl = html.find('#ncm-tc-hint');

        // ── Clock elements ──
        const clockEl = html.find('#ncm-tc-clock');
        const realClockEl = html.find('#ncm-tc-dis-real');
        const fakeClockEl = html.find('#ncm-tc-dis-fake');
        const toggleBtn = html.find('#ncm-tc-12h-toggle');
        const toggleLabel = html.find('#ncm-tc-12h-label');
        const dialogOpenedAt = Date.now();

        // Init toggle label from setting
        const _is12h = () => {
          try { return game.settings.get(MODULE_ID, 'timeFormat') === '12h'; } catch { return false; }
        };
        toggleLabel.text(_is12h() ? '12H' : '24H');

        // Shorthand: format with seconds using the global setting
        const _fmt = (isoStr) => formatCyberDate(isoStr, { seconds: true });

        // ── 12h/24h toggle — persists to setting, affects ALL clocks module-wide ──
        toggleBtn.on('click', async (e) => {
          e.preventDefault();
          const newFormat = _is12h() ? '24h' : '12h';
          await game.settings.set(MODULE_ID, 'timeFormat', newFormat);
          toggleLabel.text(newFormat === '12h' ? '12H' : '24H');
          updateAllClocks();
        });

        // ── Date format toggle — cycles YMD → DMY → MDY ──
        const dateFmtBtn = html.find('#ncm-tc-datefmt-toggle');
        const dateFmtLabel = html.find('#ncm-tc-datefmt-label');
        const _dateFmtLabels = { YMD: 'Y.M.D', DMY: 'D.M.Y', MDY: 'M.D.Y' };
        const _dateFmtCycle = { YMD: 'DMY', DMY: 'MDY', MDY: 'YMD' };

        dateFmtBtn.on('click', async (e) => {
          e.preventDefault();
          let current = 'YMD';
          try { current = game.settings.get(MODULE_ID, 'dateFormat') || 'YMD'; } catch { /* */ }
          const next = _dateFmtCycle[current] || 'YMD';
          await game.settings.set(MODULE_ID, 'dateFormat', next);
          dateFmtLabel.text(_dateFmtLabels[next]);
          updateAllClocks();
        });

        // ── Update all clocks ──
        const updateAllClocks = () => {
          // Main status clock
          clockEl.text(_fmt(ts.getCurrentTime()));

          // Disguised preview — only if visible
          if (disguisedPanel.is(':visible')) {
            realClockEl.text(_fmt(new Date().toISOString()));

            const date = html.find('#ncm-tc-dis-date').val();
            const time = html.find('#ncm-tc-dis-time').val();
            if (!date || !time) {
              fakeClockEl.text('Set date & time above');
              fakeClockEl.css('color', '#555570');
            } else {
              const baseMs = new Date(`${date}T${time}:00`).getTime();
              if (isNaN(baseMs)) {
                fakeClockEl.text('Invalid date');
                fakeClockEl.css('color', '#555570');
              } else {
                const elapsed = Date.now() - dialogOpenedAt;
                fakeClockEl.text(_fmt(new Date(baseMs + elapsed).toISOString()));
                fakeClockEl.css('color', '#f7c948');
              }
            }
          }
        };

        // Initial render + tick every second
        updateAllClocks();
        const clockInterval = setInterval(() => {
          if (!clockEl.closest('body').length) { clearInterval(clockInterval); return; }
          updateAllClocks();
        }, 1000);

        // Update preview when disguised inputs change
        html.find('#ncm-tc-dis-date, #ncm-tc-dis-time').on('change input', updateAllClocks);

        const hints = {
          'auto': 'Automatically picks the best available time source. Currently resolves to: ' + info.effectiveLabel,
          'simple-calendar': 'Uses SimpleCalendar\'s game clock. Requires the SimpleCalendar module.',
          'world-time': 'Uses Foundry\'s built-in world time. Compatible with SmallTime and other modules that control game.time.worldTime.',
          'real-time': 'Uses your real-world wall clock. Timestamps will reflect actual time.',
          'manual': 'Time only advances when you manually set or advance it. Full GM control.',
          'disguised': 'Real-time clock that displays a fictional date. Set "Night City, March 2045" and it ticks forward in sync with real time.',
        };

        // Mode switching
        modeSelect.on('change', () => {
          const m = modeSelect.val();
          disguisedPanel.toggle(m === 'disguised');
          manualPanel.toggle(m === 'manual');
          hintEl.text(hints[m] || '');
          updateAllClocks();
        });

        // Disguised: Anchor button
        html.find('#ncm-tc-dis-set').on('click', async () => {
          const date = html.find('#ncm-tc-dis-date').val();
          const time = html.find('#ncm-tc-dis-time').val();
          if (!date || !time) return;
          const iso = new Date(`${date}T${time}:00`).toISOString();
          await ts.setDisguisedTime(iso);
          modeSelect.val('disguised');
          disguisedPanel.show();
          manualPanel.hide();
          hintEl.text(hints['disguised']);
          ui.notifications.info(`NCM | Disguised time anchored to ${date} ${time}`);
        });

        // Disguised: Re-anchor button
        html.find('#ncm-tc-dis-reanchor').on('click', async () => {
          await ts.reanchorDisguisedTime();
          ui.notifications.info('NCM | Disguised time re-anchored to current displayed time.');
        });

        // Manual: Set button
        html.find('#ncm-tc-man-set').on('click', async () => {
          const date = html.find('#ncm-tc-man-date').val();
          const time = html.find('#ncm-tc-man-time').val();
          if (!date || !time) return;
          const iso = new Date(`${date}T${time}:00`).toISOString();
          await ts.setManualTime(iso);
          modeSelect.val('manual');
          manualPanel.show();
          disguisedPanel.hide();
          hintEl.text(hints['manual']);
          ui.notifications.info(`NCM | Manual time set to ${date} ${time}`);
        });

        // Manual: Quick advance buttons
        html.find('.ncm-tc-advance').on('click', async (e) => {
          const secs = parseInt(e.currentTarget.dataset.seconds, 10);
          if (!secs) return;
          // If not in manual mode, switch first
          if (ts._mode !== 'manual') {
            await ts.setManualTime(ts.getCurrentTime());
            modeSelect.val('manual');
            manualPanel.show();
            disguisedPanel.hide();
          }
          await ts.advanceManualTime(secs);
          // Update the date/time inputs to reflect new time
          const newTime = new Date(ts.getCurrentTime());
          html.find('#ncm-tc-man-date').val(`${newTime.getUTCFullYear()}-${String(newTime.getUTCMonth() + 1).padStart(2, '0')}-${String(newTime.getUTCDate()).padStart(2, '0')}`);
          html.find('#ncm-tc-man-time').val(`${String(newTime.getUTCHours()).padStart(2, '0')}:${String(newTime.getUTCMinutes()).padStart(2, '0')}`);
        });
      },
    }, {
      width: 460,
      height: 'auto',
      classes: ['ncm-time-config-dialog'],
    });

    dialog.render(true);
  }

  static _onOpenSoundSettings(event, target) {
    // Open sound configuration dialog
    ui.notifications.info('Sound settings — coming in a future update.');
  }

  /**
   * Open the email domain configuration dialog.
   * Simple flat list — GMs add whatever domains they want.
   */
  static async _onManageDomains(event, target) {
    const MODULE_ID_LOCAL = 'cyberpunkred-messenger';
    let domainList = [];
    try {
      const raw = game.settings.get(MODULE_ID_LOCAL, 'emailDomains');
      domainList = Array.isArray(raw) ? [...raw] : [];
    } catch { /* empty */ }

    const defaultDomain = game.settings.get(MODULE_ID_LOCAL, 'emailDefaultDomain') || 'nightcity.net';

    // Helper to build a single domain row
    const _buildRow = (domain = '') => `
      <div class="ncm-domain-row">
        <i class="fas fa-at ncm-domain-row__icon"></i>
        <div class="ncm-domain-row__field">
          <input type="text" class="ncm-domain-row__input" data-field="domain"
                 value="${domain}" placeholder="example.net" />
        </div>
        <button type="button" class="ncm-domain-row__clear" title="Remove domain">
          <i class="fas fa-xmark"></i>
        </button>
      </div>`;

    const rowsHTML = domainList.length
      ? domainList.map(d => _buildRow(d)).join('')
      : '';

    const dialogContent = `
      <div class="ncm-domain-dialog">
        <div class="ncm-domain-dialog__header">
          <div class="ncm-domain-dialog__title">Email Domains</div>
          <div class="ncm-domain-dialog__hint">Add domains players can pick during email setup.</div>
        </div>

        <div class="ncm-domain-dialog__default">
          <span class="ncm-domain-dialog__default-label">Default Domain</span>
          <div class="ncm-domain-dialog__default-field">
            <input type="text" class="ncm-domain-row__input" id="ncm-default-domain"
                   value="${defaultDomain}" placeholder="nightcity.net" />
          </div>
          <span class="ncm-domain-dialog__default-hint">fallback</span>
        </div>

        <div class="ncm-domain-dialog__divider"></div>

        <div class="ncm-domain-dialog__list-label">Additional Domains</div>
        <div class="ncm-domain-dialog__list" id="ncm-domain-list">
          ${rowsHTML}
        </div>

        <button type="button" class="ncm-domain-dialog__add" id="ncm-add-domain">
          <i class="fas fa-plus"></i> Add Domain
        </button>

        <div class="ncm-domain-dialog__divider"></div>

        <div class="ncm-domain-dialog__footer">
          <label class="ncm-domain-dialog__custom-toggle">
            <input type="checkbox" id="ncm-allow-custom" ${(game.settings.get(MODULE_ID_LOCAL, 'emailAllowCustomDomains') ?? true) ? 'checked' : ''} />
            Allow players to type custom domains
          </label>
        </div>
      </div>
    `;

    const dialog = new Dialog({
      title: 'Email Domain Configuration',
      content: dialogContent,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: 'Save',
          callback: async (html) => {
            const domains = [];
            html.find('.ncm-domain-row [data-field="domain"]').each((_, input) => {
              const v = input.value?.trim();
              if (v) domains.push(v);
            });

            const newDefault = html.find('#ncm-default-domain').val()?.trim() || 'nightcity.net';
            const allowCustom = html.find('#ncm-allow-custom').is(':checked');

            await game.settings.set(MODULE_ID_LOCAL, 'emailDomains', domains);
            await game.settings.set(MODULE_ID_LOCAL, 'emailDefaultDomain', newDefault);
            await game.settings.set(MODULE_ID_LOCAL, 'emailAllowCustomDomains', allowCustom);

            const total = domains.length + 1; // +1 for default
            ui.notifications.info(`NCM | Saved ${total} domain${total !== 1 ? 's' : ''}.`);
          },
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel',
        },
      },
      default: 'save',
      render: (html) => {
        const list = html.find('#ncm-domain-list')[0];

        // Add domain button
        html.find('#ncm-add-domain').on('click', () => {
          const temp = document.createElement('div');
          temp.innerHTML = _buildRow().trim();
          const row = temp.firstElementChild;
          list.appendChild(row);
          // Wire remove
          row.querySelector('.ncm-domain-row__clear')?.addEventListener('click', () => row.remove());
          // Focus the new input
          row.querySelector('.ncm-domain-row__input')?.focus();
        });

        // Wire existing remove buttons
        html.find('.ncm-domain-row__clear').on('click', function () {
          this.closest('.ncm-domain-row')?.remove();
        });
      },
    }, {
      classes: ['ncm-pick-dialog'],
      width: 460,
      height: 'auto',
    });

    dialog.render(true);
  }

  /**
   * Reorganize NCM journals into subfolders with human-readable names.
   * Runs the migration tool from MessageRepository.
   */
  static async _onReorganizeJournals(event, target) {
    const confirmed = await Dialog.confirm({
      title: 'Reorganize Journals',
      content: `<p>This will:</p>
        <ul style="margin: 8px 0 8px 16px; font-size: 13px;">
          <li>Create subfolders: <b>Inboxes</b>, <b>NPC Mail</b>, <b>Data Shards</b>, <b>Deleted</b></li>
          <li>Rename journals to readable names (e.g. "V — Inbox")</li>
          <li>Rename message pages (e.g. "Rogue — Need your help | 03/15/2045")</li>
          <li>Move journals into correct subfolders</li>
        </ul>
        <p>This is safe to run multiple times and won't delete any data.</p>`,
    });
    if (!confirmed) return;

    const repo = game.nightcity?.messageRepository;
    if (!repo) return ui.notifications.error('NCM | MessageRepository not available.');

    const stats = await repo.migrateJournalOrganization();
    const total = stats.inboxes + stats.contacts + stats.shards;
    if (total > 0 || stats.pages > 0) {
      ui.notifications.info(
        `NCM | Done: ${stats.inboxes} inbox(es), ${stats.contacts} NPC mail, ${stats.shards} shard(s), ${stats.pages} page(s) renamed.`
      );
    } else {
      ui.notifications.info('NCM | Journals are already organized — nothing to do.');
    }
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
    event.stopPropagation(); // Don't trigger row expand
    const messageId = target.closest('[data-message-id]')?.dataset.messageId;
    const inboxOwnerId = target.closest('[data-inbox-owner]')?.dataset.inboxOwner;
    if (!messageId) return;

    // Save scroll before async operation
    this._saveScroll();

    const confirmed = await Dialog.confirm({
      title: 'Hard Delete Message',
      content: '<p>Permanently delete this message? This cannot be undone.</p>',
    });
    if (!confirmed) return;

    try {
      if (inboxOwnerId) {
        await this.messageRepository?.hardDeleteMessage(inboxOwnerId, messageId);
      } else {
        // Fallback: scan all inboxes for this message
        for (const journal of game.journal ?? []) {
          if (!journal.name?.startsWith('NCM-Inbox-')) continue;
          const page = journal.pages?.find(p => {
            const flags = p.flags?.['cyberpunkred-messenger'];
            return flags?.messageId === messageId;
          });
          if (page) {
            await page.delete();
            break;
          }
        }
      }
      ui.notifications.info('NCM | Message permanently deleted.');
      const content = this.element?.querySelector('.ncm-admin-content');
      if (content) this._scrollPositions[this._activeTab] = content.scrollTop;
      this.render(true);
    } catch (err) {
      console.error(`${MODULE_ID} | Hard delete failed:`, err);
      ui.notifications.error('NCM | Failed to delete message.');
    }
  }

}
