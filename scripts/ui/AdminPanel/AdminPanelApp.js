/**
 * AdminPanelApp — Sprint 4: 6-Tab GM Dashboard
 * @file scripts/ui/AdminPanel/AdminPanelApp.js
 * @module cyberpunkred-messenger
 * @description GM command center with 7 tabs: Overview, Messages, Contacts,
 *              Networks, Data Shards, Spam, Tools. Condensed header with inline stat
 *              counters, HUD strip, and context-aware footer.
 *              Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, EVENTS, TEMPLATES } from '../../utils/constants.js';
import { log, isGM, formatCyberDate } from '../../utils/helpers.js';
import { DateRangePicker } from '../components/DateRangePicker.js';
import { BaseApplication } from '../BaseApplication.js';
import { ToolsTab } from './tabs/ToolsTab.js';
import { SpamTab } from './tabs/SpamTab.js';
import { ShardsTab } from './tabs/ShardsTab.js';
import { ContactsTab } from './tabs/ContactsTab.js';
import { NetworksTab } from './tabs/NetworksTab.js';
import { MessagesTab } from './tabs/MessagesTab.js';
import { OverviewTab } from './tabs/OverviewTab.js';

export class AdminPanelApp extends BaseApplication {

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
    const scheduledEntries = scheduled.map(entry => this.tabs.messages.formatScheduledEntry(entry));

    // ─── Connections + Alerts + Activity (Overview) — gathered after shards/scheduled/sceneStrip ───

    // ─── Messages tab context (NPC send-as, player actors, feed, queue, etc.) ───
    const messagesContext = this.tabs.messages.prepareContext(stats);

    // ─── Contacts (Contacts tab) ───
    const contactContext = this.tabs.contacts.prepareContext();
    const contactSummary = contactContext.contactSummary;
    const pushLog = contactContext.pushLog;

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

      // Contacts tab
      contactSummary,
      pushLog,

      // Networks tab
      ...networkContext,

      // Shards tab
      ...shardContext,

      // Spam tab
      ...this.tabs.spam.prepareContext(),

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

  // ═══════════════════════════════════════════════════════════
  //  Messages Tab v2 — Data Gathering
  // ═══════════════════════════════════════════════════════════


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

    // ── Active tab onRender hook (DOM wire-up, controls, etc.) ──
    const activeTab = this.tabs[this._activeTab];
    if (activeTab) activeTab.onRender(context, options);

    // ── Keyboard shortcuts ──
    this._setupKeyboardHandler();
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

    // ── Tab switching: 1–6 ──
    const tabMap = { '1': 'overview', '2': 'messages', '3': 'contacts', '4': 'networks', '5': 'shards', '6': 'spam', '7': 'tools' };
    if (tabMap[key]) {
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
  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Messages (delegated to MessagesTab)
  // ═══════════════════════════════════════════════════════════

  static async _onQuickSend(event, target) { return this.tabs.messages.onQuickSend(event, target); }
  static _onNpcQuickSend(event, target) { this.tabs.messages.onNpcQuickSend(event, target); }
  static _onNpcPagePrev(event, target) { this.tabs.messages.onNpcPagePrev(event, target); }
  static _onNpcPageNext(event, target) { this.tabs.messages.onNpcPageNext(event, target); }
  static _onOpenViewInboxDialog(event, target) { this.tabs.messages.onOpenViewInboxDialog(event, target); }
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

  static async _onToggleNetwork(event, target) { return this.tabs.networks.onToggle(event, target); }
  static _onOpenNetworkManager(event, target) { this.tabs.networks.onOpenManager(event, target); }
  static _onEditNetworkInManager(event, target) { this.tabs.networks.onEditInManager(event, target); }
  static _onOpenNetworkManagerLogs(event, target) { this.tabs.networks.onOpenManagerLogs(event, target); }
  static _onCreateNetwork(event, target) { this.tabs.networks.onCreate(event, target); }
  static async _onDeleteNetwork(event, target) { return this.tabs.networks.onDelete(event, target); }
  static _onToggleNetworkGroup(event, target) { this.tabs.networks.onToggleGroup(event, target); }
  static async _onToggleSceneDeadZone(event, target) { return this.tabs.networks.onToggleSceneDeadZone(event, target); }
  static _onSwitchNetworkSubView(event, target) { this.tabs.networks.onSwitchSubView(event, target); }
  static _onToggleCardLog(event, target) { this.tabs.networks.onToggleCardLog(event, target); }
  static _onDeleteLogEntry(event, target) { this.tabs.networks.onDeleteLogEntry(event, target); }
  static _onEditLogEntry(event, target) { this.tabs.networks.onEditLogEntry(event, target); }
  static _onOpenLogReference(event, target) { this.tabs.networks.onOpenLogReference(event, target); }
  static _onFilterLogType(event, target) { this.tabs.networks.onFilterLogType(event, target); }
  static _onToggleAddLogForm() { this.tabs.networks.onToggleAddLogForm(); }
  static _onAddManualLogEntry(event, target) { this.tabs.networks.onAddManualLogEntry(event, target); }
  static _onExportNetworkLogs() { this.tabs.networks.onExportLogs(); }
  static _onExportFormattedNetworkLogs() { this.tabs.networks.onExportFormattedLogs(); }
  static _onImportNetworkLogs() { this.tabs.networks.onImportLogs(); }
  static _onClearNetworkLogs() { this.tabs.networks.onClearLogs(); }
  static _onResetNetworkAuth(event, target) { this.tabs.networks.onResetAuth(event, target); }
  static async _onSendBroadcast(event, target) { return this.tabs.networks.onSendBroadcast(event, target); }
  static _onScrollMixerLeft(event, target) { this.tabs.networks.onScrollMixerLeft(event, target); }
  static _onScrollMixerRight(event, target) { this.tabs.networks.onScrollMixerRight(event, target); }
  static _onCycleNetAuthFilter() { this.tabs.networks.onCycleAuthFilter(); }
  static _onCycleNetStatusFilter() { this.tabs.networks.onCycleStatusFilter(); }
  static _onCycleNetGroupFilter() { this.tabs.networks.onCycleGroupFilter(); }
  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Data Shards (delegated to ShardsTab)
  // ═══════════════════════════════════════════════════════════

  static _onOpenShardItem(event, target) { this.tabs.shards.onOpenShardItem(event, target); }
  static async _onForceDecrypt(event, target) { return this.tabs.shards.onForceDecrypt(event, target); }
  static async _onRelockShard(event, target) { return this.tabs.shards.onRelockShard(event, target); }
  static async _onConvertItem(event, target) { return this.tabs.shards.onConvertItem(event, target); }
  static async _onQuickCreateShard(event, target) { return this.tabs.shards.onQuickCreateShard(event, target); }
  static async _onBulkRelockAll(event, target) { return this.tabs.shards.onBulkRelockAll(event, target); }
  static async _onPurgeDestroyed(event, target) { return this.tabs.shards.onPurgeDestroyed(event, target); }
  static _onConfigureShardItem(event, target) { this.tabs.shards.onConfigureShardItem(event, target); }
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

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Tools (delegated to ToolsTab)
  // ═══════════════════════════════════════════════════════════

  static _onOpenThemeCustomizer(event, target) { this.tabs.tools.onOpenThemeCustomizer(event, target); }
  static async _onForceRefreshAll(event, target) { return this.tabs.tools.onForceRefreshAll(event, target); }
  static _onRefreshStats(event, target) { this.tabs.tools.onRefreshStats(event, target); }
  static async _onExportLogs(event, target) { return this.tabs.tools.onExportLogs(event, target); }
  static async _onHealthCheck(event, target) { return this.tabs.tools.onHealthCheck(event, target); }
  static _onOpenTimeSettings(event, target) { this.tabs.tools.onOpenTimeSettings(event, target); }
  static _onOpenSoundSettings(event, target) { this.tabs.tools.onOpenSoundSettings(event, target); }
  static async _onManageDomains(event, target) { return this.tabs.tools.onManageDomains(event, target); }
  static async _onReorganizeJournals(event, target) { return this.tabs.tools.onReorganizeJournals(event, target); }
  static async _onPurgeMessages(event, target) { return this.tabs.tools.onPurgeMessages(event, target); }
  static async _onResetModule(event, target) { return this.tabs.tools.onResetModule(event, target); }
  static async _onRebuildIndex(event, target) { return this.tabs.tools.onRebuildIndex(event, target); }

  // ─── Legacy Handlers ───

  static _onToggleCompactMode(event, target) {
    this._compactMode = !this._compactMode;
    this.render(true);
  }

  static async _onHardDeleteMessage(event, target) { return this.tabs.messages.onHardDelete(event, target); }

}
