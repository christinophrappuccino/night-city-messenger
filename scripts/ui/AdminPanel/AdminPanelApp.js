/**
 * AdminPanelApp — Sprint 4: 6-Tab GM Dashboard
 * @file scripts/ui/AdminPanel/AdminPanelApp.js
 * @module night-city-messenger
 * @description GM command center with 7 tabs: Overview, Messages, Contacts,
 *              Networks, Data Shards, Spam, Tools. Condensed header with inline stat
 *              counters, HUD strip, and context-aware footer.
 *              Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { wireAccessDrag } from '../../integrations/AccessPoints.js';
import { MODULE_ID, EVENTS, TEMPLATES } from '../../utils/constants.js';
import { log, isGM, formatCyberDate } from '../../utils/helpers.js';
import { DateRangePicker } from '../components/DateRangePicker.js';
import { BaseApplication } from '../BaseApplication.js';
import { ToolsTab } from './tabs/ToolsTab.js';
import { SpamTab } from './tabs/SpamTab.js';
import { ShardsTab } from './tabs/ShardsTab.js';
import { AccessTab } from './tabs/AccessTab.js';
import { TerminalsTab } from './tabs/TerminalsTab.js';
import { SecurityTab } from './tabs/SecurityTab.js';
import { ContactsTab } from './tabs/ContactsTab.js';
import { NetworksTab } from './tabs/NetworksTab.js';
import { MessagesTab } from './tabs/MessagesTab.js';
import { OverviewTab } from './tabs/OverviewTab.js';

export class AdminPanelApp extends BaseApplication {

  /** GM tool — follows the Admin Panel theme + text size (utils/adminTheme.js). */
  static ADMIN_THEMED = true;

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  /** @type {string} Active tab — one of: overview, messages, contacts, networks, shards, spam, tools */
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

  async close(options = {}) {
    if (this._boundAdminKeydown) {
      document.removeEventListener('keydown', this._boundAdminKeydown);
      this._boundAdminKeydown = null;
    }
    if (this._securitySettingHook) {
      Hooks.off('updateSetting', this._securitySettingHook);
      this._securitySettingHook = null;
    }
    this._tabFoldObs?.disconnect(); this._tabFoldObs = null;
    if (this._sceneHook) {
      for (const h of ['createScene', 'updateScene', 'deleteScene']) Hooks.off(h, this._sceneHook);
      this._sceneHook = null;
    }
    if (this._worldTimeHook) {
      Hooks.off('updateWorldTime', this._worldTimeHook);
      Hooks.off('simple-calendar-date-time-change', this._worldTimeHook);
      this._worldTimeHook = null;
    }
    // Tell every extracted tab to clean up its own intervals/listeners
    if (this._tabs) {
      for (const tab of Object.values(this._tabs)) tab.onClose();
    }
    return super.close(options);
  }

  // ── Overview tab state ── moved to tabs/OverviewTab.js

  // ── Contacts tab state ── moved to tabs/ContactsTab.js

  // ── Networks tab state ── moved to tabs/NetworksTab.js

  // ── Messages tab state ── moved to tabs/MessagesTab.js

  // ── Shards tab state ── moved to tabs/ShardsTab.js

  // ── Spam tab state ── moved to tabs/SpamTab.js

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
  get spamService() { return game.nightcity?.spamService; }

  // ═══════════════════════════════════════════════════════════
  //  Tab Controllers — lazy-initialized composition
  // ═══════════════════════════════════════════════════════════

  /**
   * Tab controller registry. Each tab encapsulates its own state,
   * data-gathering, and action-handler implementations. Static action
   * dispatchers on this class forward to these instances.
   * Lazy-init so the `this` binding is always the app instance.
   */
  get tabs() {
    if (!this._tabs) {
      this._tabs = {
        contacts: new ContactsTab(this),
        messages: new MessagesTab(this),
        networks: new NetworksTab(this),
        overview: new OverviewTab(this),
        shards: new ShardsTab(this),
        terminals: new TerminalsTab(this),
        access: new AccessTab(this),
        security: new SecurityTab(this),
        spam: new SpamTab(this),
        tools: new ToolsTab(this),
      };
    }
    return this._tabs;
  }

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
      height: 760,
    },
    actions: {
      // Tab navigation
      switchTab: AdminPanelApp._onSwitchTab,

      // ONE generic hook per tab (2026-10-27 redesign): data-action="tabAct"
      // data-owner="<tab key>" data-op="<what>" → this.tabs[owner].onAct(op, event, target).
      // New tab actions use this instead of a new static delegator each.
      tabAct: AdminPanelApp._onTabAct,
      // Pop a tab out into its own larger window, and dock it back.
      popOutTab: AdminPanelApp._openToTab,
      dockTab: AdminPanelApp._onDockTab,

      // Overview actions
      openInbox: AdminPanelApp._onOpenInbox,
      openAllInboxes: AdminPanelApp._onOpenAllInboxes,
      ovComposeAs: AdminPanelApp._onOvComposeAs,
      ovNewShard: AdminPanelApp._onOvNewShard,
      ovBroadcast: AdminPanelApp._onOvBroadcast,
      ovClearAlerts: AdminPanelApp._onOvClearAlerts,
      ovDismissAlert: AdminPanelApp._onOvDismissAlert,
      ovReplyAs: AdminPanelApp._onOvReplyAs,
      ovOpenInboxOf: AdminPanelApp._onOvOpenInboxOf,
      ovWriteTo: AdminPanelApp._onOvWriteTo,
      ovSetEmail: AdminPanelApp._onOvSetEmail,
      ovNeedFilter: AdminPanelApp._onOvNeedFilter,
      ovFeedFilter: AdminPanelApp._onOvFeedFilter,

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
      toggleNpcInbox: AdminPanelApp._onToggleNpcInbox,
      npcInboxFilter: AdminPanelApp._onNpcInboxFilter,
      npcInboxReply: AdminPanelApp._onNpcInboxReply,

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
      importActorAsNpc:    AdminPanelApp._onImportActorAsNpc,
      cgAdminNew:          AdminPanelApp._onCgAdminNew,
      cgAdminEdit:         AdminPanelApp._onCgAdminEdit,
      cgAdminDelete:       AdminPanelApp._onCgAdminDelete,
      cgAdminPush:         AdminPanelApp._onCgAdminPush,
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

      // Networks actions — the 2026-10-27 tab uses tabAct (NetworksTab.onAct);
      // these two survive for the Overview button and keyboard N.
      openNetworkManager: AdminPanelApp._onOpenNetworkManager,
      createNetwork: AdminPanelApp._onCreateNetwork,

      // Data Shards actions
      openShardItem: AdminPanelApp._onOpenShardItem,
      forceDecryptShard: AdminPanelApp._onForceDecrypt,
      relockShard: AdminPanelApp._onRelockShard,
      convertItemToShard: AdminPanelApp._onConvertItem,
      quickCreateShard: AdminPanelApp._onQuickCreateShard,
      openEncoderConfig: AdminPanelApp._onOpenEncoderConfig,
      archiveShards: AdminPanelApp._onArchiveShards,
      bulkRelockAll: AdminPanelApp._onBulkRelockAll,
      purgeDestroyed: AdminPanelApp._onPurgeDestroyed,
      configureShardItem: AdminPanelApp._onConfigureShardItem,
      shardOwnership: AdminPanelApp._onShardOwnership,
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

      // ── Terminals tab ──
      terminalImport: AdminPanelApp._onTerminalImport,
      terminalOpen: AdminPanelApp._onTerminalOpen,
      terminalConfigureAdmin: AdminPanelApp._onTerminalConfigure,
      terminalForceUnlockAdmin: AdminPanelApp._onTerminalForceUnlock,
      terminalRelock: AdminPanelApp._onTerminalRelock,
      terminalRemove: AdminPanelApp._onTerminalRemove,
      terminalSelectAdmin: AdminPanelApp._onTerminalSelect,
      terminalFilterAdmin: AdminPanelApp._onTerminalFilter,
      terminalPageAdmin: AdminPanelApp._onTerminalPage,

      // ── Security tab ──
      securityFilter: AdminPanelApp._onSecurityFilter,
      securityPage: AdminPanelApp._onSecurityPage,
      securityHeatPage: AdminPanelApp._onSecurityHeatPage,
      securityPlantPage: AdminPanelApp._onSecurityPlantPage,
      securityBinPage: AdminPanelApp._onSecurityBinPage,
      securityNewProgram: AdminPanelApp._onSecurityNewProgram,
      securityProgramLibrary: AdminPanelApp._onSecurityProgramLibrary,
      securityGateRemoveGroup: AdminPanelApp._onSecurityGateRemoveGroup,
      securityClearLog: AdminPanelApp._onSecurityClearLog,
      securityFilterActor: AdminPanelApp._onSecurityFilterActor,
      securityFilterObject: AdminPanelApp._onSecurityFilterObject,
      securityClearFilter: AdminPanelApp._onSecurityClearFilter,
      securityJump: AdminPanelApp._onSecurityJump,
      securityHeatClear: AdminPanelApp._onSecurityHeatClear,
      securityHeatClearAll: AdminPanelApp._onSecurityHeatClearAll,
      securityHeatAdjust: AdminPanelApp._onSecurityHeatAdjust,
      securityEscalate: AdminPanelApp._onSecurityEscalate,
      securityCountdownCancel: AdminPanelApp._onSecurityCountdownCancel,
      securityDefuse: AdminPanelApp._onSecurityDefuse,
      securityFireResident: AdminPanelApp._onSecurityFireResident,
      securityRemoveResident: AdminPanelApp._onSecurityRemoveResident,
      securityRestore: AdminPanelApp._onSecurityRestore,
      securityPurge: AdminPanelApp._onSecurityPurge,
      securityEmptyBin: AdminPanelApp._onSecurityEmptyBin,
      securitySaveGate: AdminPanelApp._onSecuritySaveGate,
      securityGateAddGroup: AdminPanelApp._onSecurityGateAddGroup,
      securityGateAddItem: AdminPanelApp._onSecurityGateAddItem,
      securityGateAddRole: AdminPanelApp._onSecurityGateAddRole,
      securityGateAddSkill: AdminPanelApp._onSecurityGateAddSkill,
      securityGateRemoveSkill: AdminPanelApp._onSecurityGateRemoveSkill,
      securityGateRemoveItem: AdminPanelApp._onSecurityGateRemoveItem,
      terminalExportAdmin: AdminPanelApp._onTerminalExport,
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
      damageShard: AdminPanelApp._onDamageShard,
      toggleShardDamageRoll: AdminPanelApp._onToggleShardDamageRoll,
      setShardEntryDamage: AdminPanelApp._onSetShardEntryDamage,
      repairAllShardEntries: AdminPanelApp._onRepairAllShardEntries,
      openShardEntry: AdminPanelApp._onOpenShardEntry,

      // Spam actions
      spamToggleAll: AdminPanelApp._onSpamToggleAll,
      spamToggleRecipient: AdminPanelApp._onSpamToggleRecipient,
      spamCountUp: AdminPanelApp._onSpamCountUp,
      spamCountDown: AdminPanelApp._onSpamCountDown,
      spamBlast: AdminPanelApp._onSpamBlast,
      spamFilterCategory: AdminPanelApp._onSpamFilterCategory,
      spamSelectTemplate: AdminPanelApp._onSpamSelectTemplate,
      spamSendTemplate: AdminPanelApp._onSpamSendTemplate,
      spamToggleCreator: AdminPanelApp._onSpamToggleCreator,
      spamCancelCreator: AdminPanelApp._onSpamCancelCreator,
      spamSaveTemplate: AdminPanelApp._onSpamSaveTemplate,
      spamEditTemplate: AdminPanelApp._onSpamEditTemplate,
      spamDeleteTemplate: AdminPanelApp._onSpamDeleteTemplate,
      spamToggleAutoSection: AdminPanelApp._onSpamToggleAutoSection,
      spamToggleAutoNetwork: AdminPanelApp._onSpamToggleAutoNetwork,
      spamExportTemplates: AdminPanelApp._onSpamExportTemplates,
      spamImportTemplates: AdminPanelApp._onSpamImportTemplates,

      // Tools actions
      setAdminTheme: AdminPanelApp._onSetAdminTheme,
      setAdminTextScale: AdminPanelApp._onSetAdminTextScale,
      openThemeCustomizer: AdminPanelApp._onOpenThemeCustomizer,
      forceRefreshAll: AdminPanelApp._onForceRefreshAll,
      refreshStats: AdminPanelApp._onRefreshStats,
      exportLogs: AdminPanelApp._onExportLogs,
      healthCheck: AdminPanelApp._onHealthCheck,
      openTimeSettings: AdminPanelApp._onOpenTimeSettings,
      openSoundSettings: AdminPanelApp._onOpenSoundSettings,
      manageDomains: AdminPanelApp._onManageDomains,
      reorganizeJournals: AdminPanelApp._onReorganizeJournals,
      importNCMMacros: AdminPanelApp._onImportNCMMacros,

      // Danger zone
      purgeMessages: AdminPanelApp._onPurgeMessages,
      orphanAudit: AdminPanelApp._onOrphanAudit,
      factoryReset: AdminPanelApp._onFactoryReset,

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
    const scheduledEntries = scheduled.map(entry => this.tabs.messages.formatScheduledEntry(entry));

    // ─── Connections + Alerts + Activity (Overview) — gathered after shards/scheduled/sceneStrip ───

    // ─── Messages tab context (NPC send-as, player actors, feed, queue, etc.) ───
    const messagesContext = this.tabs.messages.prepareContext(stats);

    // ─── Contacts (Contacts tab) ───
    const contactContext = this.tabs.contacts.prepareContext();
    const contactSummary = contactContext.contactSummary;

    // ─── Networks (Networks tab) ───
    const networkContext = this.tabs.networks.prepareContext();
    const networks = networkContext.networks;
    const sceneStrip = networkContext.sceneStrip;

    // ─── Data Shards (Shards tab) ───
    const shardContext = this.tabs.shards.prepareContext();
    const shards = shardContext.shards;

    // ─── Push Log (Contacts tab) ───

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
      isPopout: this.isPopout,
      popTitle: this.isPopout ? this.title : '',
      compactMode: this._compactMode,

      // Header
      stats,
      scheduledCount: scheduled.length,
      onlineCount,
      currentNetwork,
      hudCounts,

      // Overview tab
      ...this.tabs.overview.prepareContext(stats, shards, scheduledEntries, sceneStrip),

      // Messages tab
      ...messagesContext,
      scheduledEntries,

      // Contacts tab — spread the WHOLE tab context. Lifting named keys out
      // of it dropped `masterGroups` on the floor (tester 2026-10-22: "groups
      // save but never appear in the admin UI"), so the Groups card always
      // rendered its empty state and Push was unreachable.
      ...contactContext,

      // Networks tab
      ...networkContext,

      // Shards tab
      ...shardContext,

      // Terminals tab
      ...this.tabs.terminals.prepareContext(),

      // Access points tab
      ...this.tabs.access.prepareContext(),

      // Security tab
      ...this.tabs.security.prepareContext(),

      // Spam tab
      ...this.tabs.spam.prepareContext(),

      // Tools tab
      ...this.tabs.tools.prepareContext(),

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
          lastActive: unread === 0 ? this._relativeTime(messages[0]?.timestamp) : '',   // a message stamp = game clock
        });
      }

      stats.actorStats.sort((a, b) => b.totalMessages - a.totalMessages);
    } catch (error) {
      console.error(`${MODULE_ID} | AdminPanelApp._gatherStats:`, error);
    }

    return stats;
  }

  // ═══════════════════════════════════════════════════════════
  //  Messages Tab v2 — Data Gathering
  // ═══════════════════════════════════════════════════════════


  /**
   * Relative time helper for message timestamps.
   * @param {string} isoTimestamp
   * @returns {string}
   */
  _relativeTime(isoTimestamp, { real = false } = {}) {
    try {
      // Mail, trace rows, readAt, login footprints … are stamped on the GAME clock, so "how long ago" must be
      // measured against the game clock too (2026-10-28, dev: mail sent at game time 11 Mar 2026 read
      // "last mail · 231d ago" because this compared it to the computer's real date). Pass { real: true }
      // only for stamps written with the real clock (delivery failures, group pushes).
      const now = real ? Date.now() : (Number(game.nightcity?.timeService?.getCurrentTimeMs?.()) || Date.now());
      const diff = Math.max(0, now - new Date(isoTimestamp).getTime());
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins} min ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours} hr ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    } catch { return ''; }
  }

  // ═══════════════════════════════════════════════════════════
  //  Data Helpers — Sprint 6: Networks Tab Enhancements
  // ═══════════════════════════════════════════════════════════

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

  // Shard data gathering, grouping, and activity log moved to tabs/ShardsTab.js

  // _gatherPushLog moved to tabs/ContactsTab.js

  // ═══════════════════════════════════════════════════════════
  //  Format Helpers
  // ═══════════════════════════════════════════════════════════

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
  /**
   * Apply the GM Admin Panel's own theme — independent of the player theme.
   * Sets the preset data-attribute (CSS in admin-theme.css scopes --ncm-*
   * overrides to this panel) and force-suppresses the diegetic atmosphere
   * (scanlines/neon) regardless of the player's prefs. This is a GM tool.
   * @private
   */
  // (Implementation lives in BaseApplication._applyAdminTheme — this panel is
  //  just one of the ADMIN_THEMED windows; see utils/adminTheme.js.)

  /**
   * Typing into a search box re-renders its tab, and the render REPLACES the box. Keys typed while
   * a render is in flight landed in the old box and the new one came back with an older value and
   * a caret in the wrong place — the "jumbled text" in Contacts search (tester, 2026-10-29), and
   * the same race in every tab. So the panel itself remembers the focused text box — its live
   * value and caret — just before a render, and puts both back after it (see _restoreTyping).
   * @override
   */
  async _preRender(context, options) {
    await super._preRender?.(context, options);
    this._typing = null;
    const el = document.activeElement;
    if (!el || !this.element?.contains(el) || !el.matches?.('input[type="text"], input[type="search"], input:not([type]), textarea')) return;
    const attrs = [...el.attributes].filter(a => a.name.startsWith('data-') && !/[\]"]/.test(a.value)).map(a => `[${a.name}="${a.value}"]`).join('');
    const sel = attrs ? `${el.tagName.toLowerCase()}${attrs}` : (el.name ? `${el.tagName.toLowerCase()}[name="${el.name}"]` : null);
    if (sel) this._typing = { sel, value: el.value, start: el.selectionStart, end: el.selectionEnd };
  }

  /** @private Put the focused text box back as it was typed, and let its tab catch up if it moved on. */
  _restoreTyping() {
    const t = this._typing;
    this._typing = null;
    if (!t) return;
    let box = null;
    try { box = this.element?.querySelector(t.sel); } catch { return; }
    if (!box) return;
    const changed = box.value !== t.value;
    if (changed) box.value = t.value;
    if (document.activeElement !== box) box.focus({ preventScroll: true });
    try { box.setSelectionRange(Math.min(t.start ?? t.value.length, t.value.length), Math.min(t.end ?? t.value.length, t.value.length)); } catch { /* not a text box */ }
    // The tab rendered from an older value: one input event lets its own debounce re-filter.
    if (changed) box.dispatchEvent(new Event('input', { bubbles: true }));
  }

  _onRender(context, options) {
    // BaseApplication applies the admin theme (preset + text size) after the
    // atmosphere pass because ADMIN_THEMED is true on this class.
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

    // ── Active tab onRender hook (DOM wire-up, controls, etc.) ──
    // A tab's own wiring must never stop the panel's shared steps below (tab-bar folding, address colours, drag
    // handles) — an error there used to leave the whole panel half-styled. Report it and carry on.
    const activeTab = this.tabs[this._activeTab];
    if (activeTab) {
      try { activeTab.onRender(context, options); }
      catch (err) { log.error(`Admin panel — the ${this._activeTab} tab's wiring failed: ${err.message}`); console.error(err); }
    }

    // ── The grouped tab bar folds its labels when the row runs out of room ──
    this._wireTabFold();
    try { this._clockRenderedAt = Number(game.nightcity?.timeService?.getCurrentTimeMs?.()); } catch { /* no clock */ }

    // ── Text roles: an email address gets its own colour + mono (admin-hierarchy.css) ──
    this._tagAddresses();

    // ── Terminal racks + shard cartridges drag onto the hotbar as an access macro ──
    wireAccessDrag(this.element, '.ncm-term2-ru[data-item-id], .ncm-sh2-slot[data-item-id]', (id) => AdminPanelApp._findItem(id));

    // ── Page heads are one line; a description cut off by the ellipsis shows in full on hover ──
    for (const p of this.element?.querySelectorAll('.ncm-tabhd p') ?? []) {
      if (!p.dataset.tooltip) p.dataset.tooltip = p.textContent.trim();
    }

    // ── The search box being typed in keeps every key and its caret across the render ──
    this._restoreTyping();

    // ── Keyboard shortcuts ──
    this._setupKeyboardHandler();
  }

  /** Tabs that print game time (ages, countdowns, the clock) — the only ones the game clock re-renders. */
  static CLOCK_TABS = Object.freeze(new Set(['overview', 'messages', 'security', 'terminals', 'shards']));
  /** Game-time movement (ms) below which a clock tick does not re-render — a real-time clock ticks every second. */
  static CLOCK_RERENDER_MS = 60000;

  /**
   * The game clock moved. A real-time clock (Simple Calendar, or a world-time ticker) fires this every second, and a
   * full re-render every second replayed the panel's entrance animations (dev 2026-10-29: "it keeps redoing the open
   * animation of the nav, sliding in every second"). So: only a tab that prints game time re-renders, and only once
   * the clock has moved a minute since the last time it did — or at once for a deliberate change (Set time, a
   * provider switch: `force`). The Overview and Security tabs tick their own clocks in the DOM between re-renders.
   * @param {boolean} force
   * @private
   */
  _onGameClock(force) {
    if (!AdminPanelApp.CLOCK_TABS.has(this._activeTab)) return;
    let now = NaN;
    try { now = Number(game.nightcity?.timeService?.getCurrentTimeMs?.()); } catch { /* no clock */ }
    if (!force && Number.isFinite(now) && Number.isFinite(this._clockRenderedAt) && Math.abs(now - this._clockRenderedAt) < AdminPanelApp.CLOCK_RERENDER_MS) return;
    this._clockRenderedAt = now;
    this._debouncedRender();
  }

  /** Number keys → tabs, in the order the grouped bar shows them. */
  static TAB_KEYS = Object.freeze({ '1': 'overview', '2': 'messages', '3': 'contacts', '4': 'spam', '5': 'networks', '6': 'security', '7': 'terminals', '8': 'shards', '9': 'access', '0': 'tools' });

  /**
   * Fold the grouped tab bar's labels when it overflows, in a fixed order: tabs OUTSIDE the open group
   * become icon-only first, then the rest of the open group; the open tab always keeps its label. Every
   * tab already names itself on hover (data-tooltip), so a folded icon is never a mystery. Re-measured
   * when the window resizes (one ResizeObserver per rendered bar).
   * @private
   */
  _wireTabFold() {
    const nav = this.element?.querySelector('.ncm-admin-tabs--grouped');
    this._tabFoldObs?.disconnect();
    if (!nav) return;
    const fold = () => {
      const tabs = [...nav.querySelectorAll('.ncm-admin-tab')];
      const openGroup = nav.querySelector('.ncm-admin-tab--active')?.closest('[data-tab-group]');
      nav.querySelectorAll('[data-tab-group]').forEach(g => g.classList.toggle('is-open', g === openGroup));
      tabs.forEach(t => t.classList.remove('is-fold'));
      const over = () => nav.scrollWidth > nav.clientWidth + 1;
      if (over()) tabs.filter(t => t.closest('[data-tab-group]') !== openGroup).forEach(t => t.classList.add('is-fold'));
      if (over()) tabs.filter(t => !t.classList.contains('ncm-admin-tab--active')).forEach(t => t.classList.add('is-fold'));
    };
    fold();
    if (typeof ResizeObserver !== 'undefined') {
      this._tabFoldObs = new ResizeObserver(() => fold());
      this._tabFoldObs.observe(nav);
    }
  }

  /**
   * Wrap every email address printed in the tab content in `<span class="ncm-addr">`
   * so it reads as an address, not as more of the same text (the colour hierarchy,
   * 2026-10-27). One pass over text nodes; inputs, editable areas and spans already
   * tagged are skipped, so it is safe on every render.
   * @private
   */
  _tagAddresses() {
    const root = this.element?.querySelector('.ncm-admin-content');
    if (!root || typeof document === 'undefined') return;
    const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*/g;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || !n.nodeValue.includes('@')) return NodeFilter.FILTER_REJECT;
        if (p.closest('input, textarea, select, option, script, style, [contenteditable], .ncm-addr')) return NodeFilter.FILTER_REJECT;
        EMAIL.lastIndex = 0;
        return EMAIL.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const hits = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) hits.push(n);
    for (const t of hits) {
      const frag = document.createDocumentFragment();
      let last = 0; const s = t.nodeValue;
      EMAIL.lastIndex = 0;
      for (let m = EMAIL.exec(s); m; m = EMAIL.exec(s)) {
        if (m.index > last) frag.append(s.slice(last, m.index));
        const span = document.createElement('span'); span.className = 'ncm-addr'; span.textContent = m[0];
        frag.append(span); last = m.index + m[0].length;
      }
      if (last < s.length) frag.append(s.slice(last));
      t.replaceWith(frag);
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
   * Set up keyboard shortcut handler on the app element.
   * Re-binds each render to ensure fresh DOM reference.
   */
  _setupKeyboardHandler() {
    if (!this.element) return;

    // Remove previous document-level handler
    if (this._boundAdminKeydown) {
      document.removeEventListener('keydown', this._boundAdminKeydown);
    }

    this._boundAdminKeydown = (e) => this._onAdminKeydown(e);
    document.addEventListener('keydown', this._boundAdminKeydown);
  }

  /**
   * Handle keyboard shortcuts for the Admin Panel.
   * Shortcuts are tab-context-sensitive.
   */
  _onAdminKeydown(event) {
    if (!this.element) return;

    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target.isContentEditable) return;

    // Guard: skip if active element is in a different app
    const activeApp = event.target.closest?.('.application, .app');
    if (activeApp && !this.element.contains(activeApp) && activeApp !== this.element) return;

    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const key = event.key;
    const tab = this._activeTab;

    // ── Tab switching: 1–9, in the grouped bar's order (Overview · Comms · Net · World · Tools) ──
    const tabMap = AdminPanelApp.TAB_KEYS;
    if (tabMap[key] && !this.isPopout) {
      event.preventDefault();
      if (tab !== tabMap[key]) {
        const content = this.element?.querySelector('.ncm-admin-content');
        if (content) this._scrollPositions[tab] = content.scrollTop;
        this._activeTab = tabMap[key];
        this._pendingContentScrollReset = true;
        this.render();
      }
      return;
    }

    // ── Per-tab shortcuts ──
    switch (tab) {

      case 'overview':
        if (key === 'r' || key === 'R') {
          event.preventDefault();
          AdminPanelApp._onRefreshStats.call(this, event, this.element);
        }
        break;

      case 'messages':
        if (key === 'n' || key === 'N') {
          event.preventDefault();
          AdminPanelApp._onOpenComposer.call(this, event, this.element);
        }
        break;

      case 'contacts':
        if (key === '/') {
          event.preventDefault();
          this.element?.querySelector('.ncm-admin-contacts-search, [data-field="contactSearch"]')?.focus();
        } else if (key === 'n' || key === 'N') {
          event.preventDefault();
          AdminPanelApp._onCreateNewContact.call(this, event, this.element);
        } else if ((key === 'p' || key === 'P') && this.tabs.contacts._expandedId) {
          event.preventDefault();
          // Push the expanded contact to players
          const btn = this.element?.querySelector(`[data-contact-id="${this.tabs.contacts._expandedId}"] [data-action="pushContact"]`);
          if (btn) btn.click();
        }
        break;

      case 'networks':
        if (key === 'n' || key === 'N') {
          event.preventDefault();
          AdminPanelApp._onCreateNetwork.call(this, event, this.element);
        }
        break;

      case 'shards': {
        const selected = this.tabs.shards._selectedIds;
        if (key === '/' ) {
          event.preventDefault();
          this.element?.querySelector('.ncm-admin-shard-search, [data-field="shardSearch"]')?.focus();
        } else if ((key === 'f' || key === 'F') && selected.size > 0) {
          event.preventDefault();
          // Force decrypt first selected shard
          const firstId = [...selected][0];
          const btn = this.element?.querySelector(`[data-item-id="${firstId}"] [data-action="forceDecryptShardItem"]`);
          if (btn) btn.click();
        } else if ((key === 'r' || key === 'R') && selected.size > 0) {
          event.preventDefault();
          const firstId = [...selected][0];
          const btn = this.element?.querySelector(`[data-item-id="${firstId}"] [data-action="relockShardItem"]`);
          if (btn) btn.click();
        }
        break;
      }
    }
  }

  // _setupContactsControls moved to tabs/ContactsTab.js onRender()

  // _setupShardControls moved to tabs/ShardsTab.js onRender()

  // ═══════════════════════════════════════════════════════════
  //  Event Subscriptions
  // ═══════════════════════════════════════════════════════════

  _setupEventSubscriptions() {
    // ── Security tab live refresh ──
    // The trace log / heat / countdowns / recycle bin are WORLD SETTINGS, not
    // EventBus events — the `updateSetting` document hook is the one signal
    // that fires on every client (including the writer) whenever they change.
    // Debounced render so a burst (log row + heat bump) paints once; only when
    // the Security tab is actually on screen.
    this._securitySettingHook = (setting) => {
      const key = String(setting?.key || '');
      if (!key.startsWith(`${MODULE_ID}.`)) return;
      const leaf = key.slice(MODULE_ID.length + 1);
      // The GAME CLOCK being set / advanced / re-provided (2026-10-28, dev: "is anything that uses live time
      // live?") — every tab prints game-time ages, countdowns and the clock, so any of them re-renders.
      if (['manualTime', 'disguisedBaseTime', 'disguisedAnchor', 'timeProvider'].includes(leaf)) return this._onGameClock(true);
      if (!['traceLog', 'traceHeat', 'traceCountdowns', 'recycleBin'].includes(leaf)) return;
      if (this._activeTab === 'security') this._debouncedRender();
    };
    Hooks.on('updateSetting', this._securitySettingHook);
    // World time (the Foundry clock + Simple Calendar) advancing: same reason. SC's own hook fires on a
    // calendar change even when Foundry's world time is untouched (its "date-time-change" event name).
    this._worldTimeHook = () => this._onGameClock(false);
    Hooks.on('updateWorldTime', this._worldTimeHook);
    Hooks.on('simple-calendar-date-time-change', this._worldTimeHook);
    // Scenes changing under the Networks tab: a new scene's thumbnail is generated a moment AFTER
    // it is created (tester, 2026-10-29: "a newly added scene doesn't update its picture"), and a
    // rename / folder move / delete should show too. Only while Networks is on screen.
    this._sceneHook = (doc, change) => {
      if (this._activeTab !== 'networks') return;
      if (change && typeof change === 'object' && !('thumb' in change || 'name' in change || 'folder' in change || 'navigation' in change || 'flags' in change)) return;
      this._debouncedRender();
    };
    for (const h of ['createScene', 'updateScene', 'deleteScene']) Hooks.on(h, this._sceneHook);

    // Messages — with overview activity logging
    this.subscribe(EVENTS.MESSAGE_SENT, (data) => {
      const from = data?.fromName || game.actors.get(data?.fromActorId)?.name || 'Unknown';
      const to = data?.toName || game.actors.get(data?.toActorId)?.name || 'Unknown';
      this.tabs.overview.logActivity('msg', 'paper-plane',
        `<strong>${from}</strong> sent message to <span class="ncm-ov-hl--cyan">${to}</span>`,
        { actorId: data?.fromActorId });
      this._refreshIfTab('overview', 'messages');
    });
    this.subscribe(EVENTS.MESSAGE_RECEIVED, (data) => {
      const from = data?.fromName || game.actors.get(data?.fromActorId)?.name || 'Unknown';
      const to = data?.toName || game.actors.get(data?.toActorId)?.name || 'Unknown';
      this.tabs.overview.logActivity('msg', 'envelope',
        `<strong>${to}</strong> received message from <span class="ncm-ov-hl--cyan">${from}</span>`,
        { actorId: data?.toActorId });
      this._refreshIfTab('overview', 'messages');
    });
    this.subscribe(EVENTS.MESSAGE_SCHEDULED, (data) => {
      this.tabs.overview.logActivity('msg', 'clock',
        `Message scheduled for delivery`,
        {});
      this._refreshIfTab('overview', 'messages');
    });
    this.subscribe(EVENTS.MESSAGE_DELETED, () => this._refreshIfTab('overview', 'messages'));
    this.subscribe('schedule:updated', () => this._refreshIfTab('overview', 'messages'));

    // Contacts — with overview activity logging
    this.subscribe(EVENTS.CONTACT_TRUST_CHANGED, () => this._refreshIfTab('contacts'));
    this.subscribe(EVENTS.CONTACT_BURNED, () => this._refreshIfTab('contacts'));
    this.subscribe('roles:updated', () => this._refreshIfTab('contacts'));                       // Role Manager edits recolour / rename tags live
    this.subscribe('contacts:masterUpdated', () => this._refreshIfTab('contacts'));
    this.subscribe(EVENTS.CONTACT_SHARED, (data) => {
      const contactName = data?.contactName || 'Unknown';
      const targetName = data?.targetActorName || game.actors.get(data?.targetActorId)?.name || 'Unknown';
      this.tabs.overview.logActivity('contact', 'user-plus',
        `Contact <span class="ncm-ov-hl--purple">"${contactName}"</span> pushed to ${targetName}`,
        {});
      this._refreshIfTab('overview', 'contacts');
    });
    this.subscribe(EVENTS.CONTACT_UPDATED, () => this._debouncedRender());

    // Networks — with overview activity logging
    this.subscribe(EVENTS.NETWORK_CHANGED, (data) => {
      // a node changed (utils/networkNodes.js) — not a switch: refresh, never log "switched to Unknown"
      if (data?.type === 'nodes') return this._refreshIfTab('networks', 'overview');
      const netName = data?.networkName || data?.networkId || 'Unknown';
      this.tabs.overview.logActivity('net', 'wifi',
        `Network switched to <span class="ncm-ov-hl--green">${netName}</span>`,
        {});
      this._refreshIfTab('networks', 'overview');
    });
    this.subscribe(EVENTS.NETWORK_CONNECTED, (data) => {
      const netName = data?.networkName || data?.networkId || 'Unknown';
      this.tabs.overview.logActivity('net', 'plug',
        `Connected to network <span class="ncm-ov-hl--green">${netName}</span>`,
        {});
      this._refreshIfTab('networks', 'overview');
    });
    this.subscribe(EVENTS.NETWORK_DISCONNECTED, (data) => {
      const netName = data?.networkName || data?.networkId || 'Unknown';
      this.tabs.overview.logActivity('net', 'ban',
        `Disconnected from network <span class="ncm-ov-hl--red">${netName}</span>`,
        {});
      this._refreshIfTab('networks', 'overview');
    });
    this.subscribe(EVENTS.NETWORK_AUTH_SUCCESS, () => this._refreshIfTab('networks'));
    this.subscribe(EVENTS.NETWORK_AUTH_FAILURE, () => this._refreshIfTab('networks'));
    this.subscribe(EVENTS.NETWORK_LOCKOUT, () => this._refreshIfTab('networks'));

    // Data Shards — with overview activity logging
    this.subscribe(EVENTS.SHARD_DECRYPTED, (data) => {
      this.tabs.shards.logActivity('success', 'check', data, 'breached');
      const actorName = data.actorId ? game.actors?.get(data.actorId)?.name : 'GM';
      const shardName = data.itemId ? game.items?.get(data.itemId)?.name : 'Unknown';
      this.tabs.overview.logActivity('shard', 'unlock',
        `<strong>${actorName || 'Unknown'}</strong> breached shard <span class="ncm-ov-hl--gold">"${shardName}"</span>`,
        { itemId: data.itemId });
      this._refreshIfTab('overview', 'shards');
    });
    this.subscribe(EVENTS.SHARD_RELOCKED, (data) => {
      this.tabs.shards.logActivity('gm', 'lock', data, 'relocked by GM');
      this._refreshIfTab('shards');
    });
    this.subscribe(EVENTS.SHARD_HACK_ATTEMPT, (data) => {
      const type = data.success ? 'success' : 'fail';
      const icon = data.success ? 'check' : 'xmark';
      const text = data.success
        ? `breached (${data.roll} vs DV ${data.dc})`
        : `hack FAILED (${data.roll} vs DV ${data.dc})`;
      this.tabs.shards.logActivity(type, icon, data, text);
      this._refreshIfTab('shards');
    });
    this.subscribe(EVENTS.SHARD_CREATED, (data) => {
      this.tabs.shards.logActivity('gm', 'plus', data, 'created');
      const shardName = data.itemId ? game.items?.get(data.itemId)?.name : 'New Shard';
      this.tabs.overview.logActivity('shard', 'database',
        `Data shard <span class="ncm-ov-hl--gold">"${shardName}"</span> created`,
        { itemId: data.itemId });
      this._refreshIfTab('overview', 'shards');
    });
    this.subscribe(EVENTS.SHARD_STATE_CHANGED, () => this._debouncedRender());
    this.subscribe(EVENTS.SHARD_INTEGRITY_CHANGED, (data) => {
      this.tabs.shards.logActivity('fail', 'triangle-exclamation', data, `integrity → ${data.newIntegrity}%`);
      this._refreshIfTab('shards');
    });
    this.subscribe(EVENTS.BLACK_ICE_DAMAGE, (data) => {
      const actorName = data.actorId ? game.actors?.get(data.actorId)?.name : 'Unknown';
      const damage = data.damage || '?';
      this.tabs.overview.logActivity('alert', 'shield-virus',
        `<span class="ncm-ov-hl--red">BLACK ICE</span> dealt ${damage} HP damage to <strong>${actorName}</strong>`,
        { actorId: data.actorId });
      this._refreshIfTab('overview');
    });
    this.subscribe(EVENTS.SHARD_EDDIES_CLAIMED, (data) => {
      this.tabs.shards.logActivity('success', 'coins', data, `claimed ${data.amount?.toLocaleString() ?? '?'} eb`);
      const actorName = data.actorId ? game.actors?.get(data.actorId)?.name : 'Unknown';
      this.tabs.overview.logActivity('shard', 'coins',
        `<strong>${actorName}</strong> claimed <span class="ncm-ov-hl--gold">${data.amount?.toLocaleString() ?? '?'} eb</span>`,
        { actorId: data.actorId });
      this._refreshIfTab('overview', 'shards');
    });
    this.subscribe(EVENTS.SHARD_PRESET_APPLIED, (data) => {
      this.tabs.shards.logActivity('gm', 'palette', data, `preset "${data.preset}" applied`);
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

  /**
   * Generic per-tab action: the tab named by data-owner (on the target or an
   * ancestor) handles data-op in its onAct(op, event, target).
   */
  static _onTabAct(event, target) {
    const owner = target.dataset.owner || target.closest('[data-owner]')?.dataset.owner;
    const op = target.dataset.op;
    const tab = owner && this.tabs[owner];
    if (!tab || typeof tab.onAct !== 'function') { log.warn(`Admin tabAct: no handler for ${owner}:${op}`); return; }
    return tab.onAct(op, event, target);
  }

  /** Open a tab in its own larger window (the redesign's Pop out). */
  static async _openToTab(event, target) {
    const tab = target.dataset.tab || target.closest('[data-tab]')?.dataset.tab || this._activeTab;
    return AdminPanelApp.openTabWindow(tab, { select: target.dataset.select });
  }

  /** From a popped-out window: close it and bring the panel back on that tab. */
  static async _onDockTab() {
    const tab = this._activeTab;
    await this.close();
    const panel = await game.nightcity?.openAdmin?.();
    if (panel) { panel._activeTab = tab; panel.render(true); }
  }

  /**
   * Open (or focus) the popped-out window for one tab.
   * @param {string} tab — tab key
   * @param {object} [opts] — { select }: handed to the tab's openTo(select) when it has one
   * @returns {Promise<AdminPanelApp>}
   */
  static async openTabWindow(tab, opts = {}) {
    const { AdminTabWindow } = await import('./AdminTabWindow.js');
    const id = `ncm-admin-pop-${tab}`;
    let win = foundry.applications.instances?.get?.(id);
    if (!win) win = new AdminTabWindow({ id, popTab: tab });
    if (opts.select && typeof win.tabs[tab]?.openTo === 'function') win.tabs[tab].openTo(opts.select);
    await win.render(true);
    win.bringToFront?.();
    return win;
  }

  /** True on a popped-out single-tab window (AdminTabWindow). */
  get isPopout() { return false; }

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
  //  Action Handlers — Overview (delegated to OverviewTab)
  // ═══════════════════════════════════════════════════════════

  static async _onOpenInbox(event, target) { return this.tabs.overview.onOpenInbox(event, target); }
  static _onOpenAllInboxes(event, target) { this.tabs.overview.onOpenAllInboxes(event, target); }
  static _onOvComposeAs(event, target) { this.tabs.overview.onComposeAs(event, target); }
  static _onOvNewShard(event, target) { this.tabs.overview.onNewShard(event, target); }
  static _onOvBroadcast(event, target) { this.tabs.overview.onBroadcast(event, target); }
  static _onOvClearAlerts(event, target) { this.tabs.overview.onClearAlerts(event, target); }
  static _onOvDismissAlert(event, target) { this.tabs.overview.onDismissAlert(event, target); }
  static _onOvReplyAs(event, target) { this.tabs.overview.onReplyAs(event, target); }
  static _onOvOpenInboxOf(event, target) { this.tabs.overview.onOpenInboxOf(event, target); }
  static _onOvWriteTo(event, target) { this.tabs.overview.onWriteTo(event, target); }
  static _onOvSetEmail(event, target) { this.tabs.overview.onSetEmail(event, target); }
  static _onOvNeedFilter(event, target) { this.tabs.overview.onNeedFilter(event, target); }
  static _onOvFeedFilter(event, target) { this.tabs.overview.onFeedFilter(event, target); }
  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Messages (delegated to MessagesTab)
  // ═══════════════════════════════════════════════════════════

  static async _onQuickSend(event, target) { return this.tabs.messages.onQuickSend(event, target); }
  static _onNpcQuickSend(event, target) { this.tabs.messages.onNpcQuickSend(event, target); }
  static _onNpcPagePrev(event, target) { this.tabs.messages.onNpcPagePrev(event, target); }
  static _onNpcPageNext(event, target) { this.tabs.messages.onNpcPageNext(event, target); }
  static _onOpenViewInboxDialog(event, target) { this.tabs.messages.onOpenViewInboxDialog(event, target); }
  static _onToggleNpcInbox(event, target) { this.tabs.messages.onToggleNpcInbox(event, target); }
  static _onNpcInboxFilter(event, target) { this.tabs.messages.onNpcInboxFilter(event, target); }
  static async _onNpcInboxReply(event, target) { return this.tabs.messages.onNpcInboxReply(event, target); }
  static _onOpenComposer(event, target) { this.tabs.messages.onOpenComposer(event, target); }
  static async _onCancelScheduled(event, target) { return this.tabs.messages.onCancelScheduled(event, target); }
  static async _onEditScheduled(event, target) { return this.tabs.messages.onEditScheduled(event, target); }
  static _onMsgFeedFilter(event, target) { this.tabs.messages.onFilter(event, target); }
  static _onLoadMoreMessages(event, target) { this.tabs.messages.onLoadMore(event, target); }
  static _onOpenDateRangePicker(event, target) { this.tabs.messages.onOpenDateRangePicker(event, target); }
  static _onClearFeedDates(event, target) { this.tabs.messages.onClearFeedDates(event, target); }
  static _onToggleMsgExpand(event, target) { this.tabs.messages.onToggleExpand(event, target); }
  static _onToggleMsgActorFilter(event, target) { this.tabs.messages.onToggleActorFilter(event, target); }
  static _onSetMsgActorFilter(event, target) { this.tabs.messages.onSetActorFilter(event, target); }
  static _onOpenMsgInInbox(event, target) { this.tabs.messages.onOpenInInbox(event, target); }
  static _onReplyAsMsg(event, target) { this.tabs.messages.onReplyAs(event, target); }
  static async _onShareMsgToChat(event, target) { return this.tabs.messages.onShareToChat(event, target); }
  static async _onForceDeliverMsg(event, target) { return this.tabs.messages.onForceDeliver(event, target); }
  static async _onCancelQueuedMsg(event, target) { return this.tabs.messages.onCancelQueued(event, target); }
  static async _onFlushMsgQueue(event, target) { return this.tabs.messages.onFlushQueue(event, target); }
  static async _onMarkAllRead(event, target) { return this.tabs.messages.onMarkAllRead(event, target); }
  static async _onPurgeOldMessages(event, target) { return this.tabs.messages.onPurgeOld(event, target); }
  static async _onMsgBroadcast(event, target) { return this.tabs.messages.onBroadcast(event, target); }
  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Contacts (delegated to ContactsTab)
  // ═══════════════════════════════════════════════════════════

  static _onOpenGMContacts(event, target) { this.tabs.contacts.onOpenGMContacts(event, target); }
  static async _onCgAdminNew(event, target) { return this.tabs.contacts.onGroupNew(event, target); }
  static async _onCgAdminEdit(event, target) { return this.tabs.contacts.onGroupEdit(event, target); }
  static async _onCgAdminDelete(event, target) { return this.tabs.contacts.onGroupDelete(event, target); }
  static async _onCgAdminPush(event, target) { return this.tabs.contacts.onGroupPush(event, target); }
  static async _onPushContact(event, target) { return this.tabs.contacts.onPushContact(event, target); }
  static _onViewPlayerContacts(event, target) { this.tabs.contacts.onViewPlayerContacts(event, target); }
  static async _onGMVerifyContact(event, target) { return this.tabs.contacts.onGMVerifyContact(event, target); }
  static async _onGMUnverifyContact(event, target) { return this.tabs.contacts.onGMUnverifyContact(event, target); }
  static _onSendAsContact(event, target) { this.tabs.contacts.onSendAsContact(event, target); }
  static _onOpenContactInbox(event, target) { this.tabs.contacts.onOpenContactInbox(event, target); }
  static _onComposeToContact(event, target) { this.tabs.contacts.onComposeToContact(event, target); }
  static _onExportContacts(event, target) { this.tabs.contacts.onExportContacts(event, target); }
  static async _onImportContactsJSON(event, target) { return this.tabs.contacts.onImportContactsJSON(event, target); }
  static async _onSetContactTrust(event, target) { return this.tabs.contacts.onSetTrust(event, target); }
  static async _onEditContactInEditor(event, target) { return this.tabs.contacts.onEditInEditor(event, target); }
  static async _onCreateNewContact(event, target) { return this.tabs.contacts.onCreateNew(event, target); }
  static async _onImportActorAsNpc(event, target) { return this.tabs.contacts.onImportActorAsNpc(event, target); }
  static _onPushAllContacts(event, target) { this.tabs.contacts.onPushAll(event, target); }
  static _onContactFilter(event, target) { this.tabs.contacts.onFilter(event, target); }
  static _onContactClearSearch(event, target) { this.tabs.contacts.onClearSearch(event, target); }
  static _onToggleContactExpand(event, target) { this.tabs.contacts.onToggleExpand(event, target); }
  static _onToggleContactSelect(event, target) { this.tabs.contacts.onToggleSelect(event, target); }
  static _onClearContactSelection() { this.tabs.contacts.onClearSelection(); }
  static _onToggleContactGroup(event, target) { this.tabs.contacts.onToggleGroup(event, target); }
  static _onToggleContactOverflow(event, target) { this.tabs.contacts.onToggleOverflow(event, target); }
  static async _onBurnContact(event, target) { return this.tabs.contacts.onBurnContact(event, target); }
  static async _onShareContactToPlayer(event, target) { return this.tabs.contacts.onShareToPlayer(event, target); }
  static async _onSyncFromActors(event, target) { return this.tabs.contacts.onSyncFromActors(event, target); }
  static async _onBatchShareContacts() { return this.tabs.contacts.onBatchShare(); }
  static async _onBatchTagContacts() { return this.tabs.contacts.onBatchTag(); }
  static async _onBatchBurnContacts() { return this.tabs.contacts.onBatchBurn(); }
  static _onOpenRecentMessage(event, target) { this.tabs.contacts.onOpenRecentMessage(event, target); }
  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Networks (delegated to NetworksTab)
  // ═══════════════════════════════════════════════════════════

  // Everything else on the tab is tabAct → NetworksTab.onAct (2026-10-27 redesign).
  static _onOpenNetworkManager(event, target) { this.tabs.networks.onOpenManager(event, target); }
  static _onCreateNetwork(event, target) { this.tabs.networks.onCreate(event, target); }
  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Data Shards (delegated to ShardsTab)
  // ═══════════════════════════════════════════════════════════

  // ── Terminals tab delegators ──
  static async _onTerminalImport(event, target) { return this.tabs.terminals.onImport(event, target); }
  static _onTerminalOpen(event, target) { this.tabs.terminals.onOpen(event, target); }
  static async _onTerminalConfigure(event, target) { return this.tabs.terminals.onConfigure(event, target); }
  static async _onTerminalForceUnlock(event, target) { return this.tabs.terminals.onForceUnlock(event, target); }
  static async _onTerminalRelock(event, target) { return this.tabs.terminals.onRelock(event, target); }
  static async _onTerminalRemove(event, target) { return this.tabs.terminals.onRemove(event, target); }
  static _onTerminalSelect(event, target) { this.tabs.terminals.onSelect(event, target); }
  static _onTerminalFilter(event, target) { this.tabs.terminals.onFilter(event, target); }
  static _onTerminalPage(event, target) { this.tabs.terminals.onPage(event, target); }
  static _onTerminalExport(event, target) { this.tabs.terminals.onExport(event, target); }

  // ── Security tab delegators ──
  static _onSecurityFilter(event, target) { this.tabs.security.onFilter(event, target); }
  static _onSecurityPage(event, target) { this.tabs.security.onPage(event, target); }
  static _onSecurityClearLog(event, target) { this.tabs.security.onClearLog(event, target); }
  static _onSecurityFilterActor(event, target) { this.tabs.security.onFilterActor(event, target); }
  static _onSecurityFilterObject(event, target) { this.tabs.security.onFilterObject(event, target); }
  static _onSecurityClearFilter(event, target) { this.tabs.security.onClearFilter(event, target); }
  static _onSecurityJump(event, target) { this.tabs.security.onJump(event, target); }
  static _onSecurityHeatClear(event, target) { this.tabs.security.onHeatClear(event, target); }
  static _onSecurityHeatClearAll(event, target) { this.tabs.security.onHeatClearAll(event, target); }
  static _onSecurityHeatAdjust(event, target) { this.tabs.security.onHeatAdjust(event, target); }
  static _onSecurityEscalate(event, target) { this.tabs.security.onEscalate(event, target); }
  static _onSecurityCountdownCancel(event, target) { this.tabs.security.onCountdownCancel(event, target); }
  static _onSecurityDefuse(event, target) { this.tabs.security.onDefuse(event, target); }
  static _onSecurityFireResident(event, target) { this.tabs.security.onFireResident(event, target); }
  static _onSecurityRemoveResident(event, target) { this.tabs.security.onRemoveResident(event, target); }
  static _onSecurityRestore(event, target) { this.tabs.security.onRestore(event, target); }
  static _onSecurityPurge(event, target) { this.tabs.security.onPurge(event, target); }
  static _onSecurityEmptyBin(event, target) { this.tabs.security.onEmptyBin(event, target); }
  static _onSecuritySaveGate(event, target) { this.tabs.security.onSaveGate(event, target); }
  static _onSecurityGateAddGroup(event, target) { this.tabs.security.onGateAddGroup(event, target); }
  static _onSecurityGateAddItem(event, target) { this.tabs.security.onGateAddItem(event, target); }
  static _onSecurityGateAddRole(event, target) { this.tabs.security.onGateAddRole(event, target); }
  static _onSecurityGateRemoveItem(event, target) { this.tabs.security.onGateRemoveItem(event, target); }
  static _onSecurityGateAddSkill(event, target) { this.tabs.security.onGateAddSkill(event, target); }
  static _onSecurityGateRemoveSkill(event, target) { this.tabs.security.onGateRemoveSkill(event, target); }
  static _onSecurityHeatPage(event, target) { this.tabs.security.onHeatPage(event, target); }
  static _onSecurityPlantPage(event, target) { this.tabs.security.onPlantPage(event, target); }
  static _onSecurityBinPage(event, target) { this.tabs.security.onBinPage(event, target); }
  static _onSecurityNewProgram(event, target) { this.tabs.security.onNewProgram(event, target); }
  static _onSecurityProgramLibrary(event, target) { this.tabs.security.onProgramLibrary(event, target); }
  static _onSecurityGateRemoveGroup(event, target) { this.tabs.security.onGateRemoveGroup(event, target); }

  static _onOpenShardItem(event, target) { this.tabs.shards.onOpenShardItem(event, target); }
  static async _onForceDecrypt(event, target) { return this.tabs.shards.onForceDecrypt(event, target); }
  static async _onRelockShard(event, target) { return this.tabs.shards.onRelockShard(event, target); }
  static async _onConvertItem(event, target) { return this.tabs.shards.onConvertItem(event, target); }
  static async _onQuickCreateShard(event, target) { return this.tabs.shards.onQuickCreateShard(event, target); }

  static async _onOpenEncoderConfig(event, target) { return this.tabs.shards.onOpenEncoderConfig(event, target); }

  static async _onArchiveShards(event, target) { return this.tabs.shards.onArchiveShards(event, target); }
  static async _onBulkRelockAll(event, target) { return this.tabs.shards.onBulkRelockAll(event, target); }
  static async _onPurgeDestroyed(event, target) { return this.tabs.shards.onPurgeDestroyed(event, target); }
  static _onConfigureShardItem(event, target) { this.tabs.shards.onConfigureShardItem(event, target); }
  static _onShardOwnership(event, target) { this.tabs.shards.onShardOwnership(event, target); }
  static async _onRelockShardItem(event, target) { return this.tabs.shards.onRelockShardItem(event, target); }
  static _onToggleShardGroup(event, target) { this.tabs.shards.onToggleGroup(event, target); }
  static _onToggleShardSelectMode(event, target) { this.tabs.shards.onToggleSelectMode(event, target); }
  static _onToggleShardSelect(event, target) { this.tabs.shards.onToggleSelect(event, target); }
  static _onDeselectAllShards(event, target) { this.tabs.shards.onDeselectAll(event, target); }
  static _onExpandShard(event, target) { this.tabs.shards.onExpand(event, target); }
  static async _onBulkRelockSelected(event, target) { return this.tabs.shards.onBulkRelockSelected(event, target); }
  static _onBulkExportSelected(event, target) { this.tabs.shards.onBulkExportSelected(event, target); }
  static async _onUnconvertShard(event, target) { return this.tabs.shards.onUnconvertShard(event, target); }
  static _onCycleShardSort(event, target) { this.tabs.shards.onCycleSort(event, target); }
  static _onCycleShardIceFilter(event, target) { this.tabs.shards.onCycleIceFilter(event, target); }
  static _onCycleShardStatusFilter(event, target) { this.tabs.shards.onCycleStatusFilter(event, target); }
  static _onCycleShardPresetFilter(event, target) { this.tabs.shards.onCyclePresetFilter(event, target); }
  static _onCycleShardOwnerFilter(event, target) { this.tabs.shards.onCycleOwnerFilter(event, target); }
  static _onCycleShardGroupMode(event, target) { this.tabs.shards.onCycleGroupMode(event, target); }
  static async _onToggleShardLayer(event, target) { return this.tabs.shards.onToggleLayer(event, target); }
  static async _onForceDecryptShardItem(event, target) { return this.tabs.shards.onForceDecryptShardItem(event, target); }
  static async _onSetShardIntegrity(event, target) { return this.tabs.shards.onSetIntegrity(event, target); }
  static async _onRestoreShardIntegrity(event, target) { return this.tabs.shards.onRestoreIntegrity(event, target); }
  static async _onDamageShard(event, target) { return this.tabs.shards.onDamageShard(event, target); }
  static _onToggleShardDamageRoll(event, target) { this.tabs.shards.onToggleDamageRoll(event, target); }
  static async _onSetShardEntryDamage(event, target) { return this.tabs.shards.onSetEntryDamage(event, target); }
  static async _onRepairAllShardEntries(event, target) { return this.tabs.shards.onRepairAllEntries(event, target); }
  static _onOpenShardEntry(event, target) { this.tabs.shards.onOpenShardEntry(event, target); }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Spam (delegated to SpamTab)
  // ═══════════════════════════════════════════════════════════

  static _onSpamToggleAll(event, target) { this.tabs.spam.onToggleAll(event, target); }
  static _onSpamToggleRecipient(event, target) { this.tabs.spam.onToggleRecipient(event, target); }
  static _onSpamCountUp(event, target) { this.tabs.spam.onCountUp(event, target); }
  static _onSpamCountDown(event, target) { this.tabs.spam.onCountDown(event, target); }
  static async _onSpamBlast(event, target) { return this.tabs.spam.onBlast(event, target); }
  static _onSpamFilterCategory(event, target) { this.tabs.spam.onFilterCategory(event, target); }
  static _onSpamSelectTemplate(event, target) { this.tabs.spam.onSelectTemplate(event, target); }
  static async _onSpamSendTemplate(event, target) { return this.tabs.spam.onSendTemplate(event, target); }
  static _onSpamToggleCreator(event, target) { this.tabs.spam.onToggleCreator(event, target); }
  static _onSpamCancelCreator(event, target) { this.tabs.spam.onCancelCreator(event, target); }
  static async _onSpamSaveTemplate(event, target) { return this.tabs.spam.onSaveTemplate(event, target); }
  static _onSpamEditTemplate(event, target) { this.tabs.spam.onEditTemplate(event, target); }
  static async _onSpamDeleteTemplate(event, target) { return this.tabs.spam.onDeleteTemplate(event, target); }
  static _onSpamToggleAutoSection(event, target) { this.tabs.spam.onToggleAutoSection(event, target); }
  static async _onSpamToggleAutoNetwork(event, target) { return this.tabs.spam.onToggleAutoNetwork(event, target); }
  static _onSpamExportTemplates(event, target) { this.tabs.spam.onExportTemplates(event, target); }
  static _onSpamImportTemplates(event, target) { this.tabs.spam.onImportTemplates(event, target); }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Tools (delegated to ToolsTab)
  // ═══════════════════════════════════════════════════════════

  static async _onSetAdminTheme(event, target) { return this.tabs.tools.onSetAdminTheme(event, target); }
  static async _onSetAdminTextScale(event, target) { return this.tabs.tools.onSetAdminTextScale(event, target); }
  static _onOpenThemeCustomizer(event, target) { this.tabs.tools.onOpenThemeCustomizer(event, target); }
  static async _onForceRefreshAll(event, target) { return this.tabs.tools.onForceRefreshAll(event, target); }
  static _onRefreshStats(event, target) { this.tabs.tools.onRefreshStats(event, target); }
  static async _onExportLogs(event, target) { return this.tabs.tools.onExportLogs(event, target); }
  static async _onHealthCheck(event, target) { return this.tabs.tools.onHealthCheck(event, target); }
  static _onOpenTimeSettings(event, target) { this.tabs.tools.onOpenTimeSettings(event, target); }
  static _onOpenSoundSettings(event, target) { this.tabs.tools.onOpenSoundSettings(event, target); }
  static async _onManageDomains(event, target) { return this.tabs.tools.onManageDomains(event, target); }
  static async _onReorganizeJournals(event, target) { return this.tabs.tools.onReorganizeJournals(event, target); }
  static async _onImportNCMMacros(event, target) { return this.tabs.tools.onImportMacros(event, target); }
  static async _onPurgeMessages(event, target) { return this.tabs.tools.onPurgeMessages(event, target); }
  static async _onOrphanAudit(event, target) { return this.tabs.tools.onOrphanAudit(event, target); }
  static async _onFactoryReset(event, target) { return this.tabs.tools.onFactoryReset(event, target); }

  // ─── Legacy Handlers ───

  static _onToggleCompactMode(event, target) {
    this._compactMode = !this._compactMode;
    this.render(true);
  }

  static async _onHardDeleteMessage(event, target) { return this.tabs.messages.onHardDelete(event, target); }

}
