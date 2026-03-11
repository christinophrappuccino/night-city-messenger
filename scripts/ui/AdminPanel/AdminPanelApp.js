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
  /** @type {string} Contact sort: 'name' | 'trust' | 'role' | 'recent' */
  _contactSort = 'name';
  /** @type {string} Contact filter: 'all' | 'linked' | 'burned' | 'ice' | 'fixer' | 'netrunner' | 'solo' | 'corp' | etc */
  _contactFilter = 'all';

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

      // Networks actions
      toggleNetwork: AdminPanelApp._onToggleNetwork,
      openNetworkManager: AdminPanelApp._onOpenNetworkManager,

      // Data Shards actions
      openShardItem: AdminPanelApp._onOpenShardItem,
      forceDecryptShard: AdminPanelApp._onForceDecrypt,
      relockShard: AdminPanelApp._onRelockShard,
      convertItemToShard: AdminPanelApp._onConvertItem,

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

    // ─── Data Shards (Shards tab) ───
    const shards = this._gatherShardData();
    const shardSummary = {
      locked: shards.filter(s => s.status === 'locked').length,
      blackice: shards.filter(s => s.status === 'blackice').length,
    };

    // ─── Access Log (Shards tab) ───
    const accessLog = this._gatherAccessLog();

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
    const currentNetwork = this.networkService?.currentNetworkId ?? 'CITINET';

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
      networks,
      networkSummary,

      // Shards tab
      shards,
      shardSummary,
      accessLog,

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

    // ── Enrich all contacts ──
    const roleBadgeMap = {
      fixer: { badge: 'Fixer', cls: 'fixer' },
      netrunner: { badge: 'Runner', cls: 'netrunner' },
      runner: { badge: 'Runner', cls: 'netrunner' },
      corp: { badge: 'Corp', cls: 'corp' },
      solo: { badge: 'Solo', cls: 'solo' },
      tech: { badge: 'Tech', cls: 'solo' },
      medtech: { badge: 'Medtech', cls: 'solo' },
      media: { badge: 'Media', cls: 'netrunner' },
      nomad: { badge: 'Nomad', cls: 'solo' },
      exec: { badge: 'Exec', cls: 'corp' },
      lawman: { badge: 'Lawman', cls: 'fixer' },
      rockerboy: { badge: 'Rocker', cls: 'fixer' },
    };

    const enriched = contacts.map(c => {
      const trust = c.trust ?? 3;
      let trustLevel = 'med';
      if (trust >= 4) trustLevel = 'high';
      else if (trust <= 1) trustLevel = 'low';

      const roleLower = (c.role || '').toLowerCase();
      const roleInfo = roleBadgeMap[roleLower];

      const avatarColor = c.burned ? '#ff0033' : c.encrypted ? '#f7c948' : '#8888a0';

      let actorName = null;
      let playerOwnerName = null;
      if (c.actorId) {
        const actor = game.actors?.get(c.actorId);
        actorName = actor?.name || null;
        if (actor?.hasPlayerOwner) {
          const ownerEntry = Object.entries(actor.ownership || {}).find(
            ([uid, level]) => uid !== 'default' && level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
          );
          if (ownerEntry) {
            playerOwnerName = game.users.get(ownerEntry[0])?.name || null;
          }
        }
      }

      return {
        id: c.id,
        name: c.name,
        email: c.email || '—',
        role: c.role,
        roleLower,
        trust,
        trustLevel,
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
        linkedActorId: c.linkedActorId,
        actorId: c.actorId || null,
        actorName,
        playerOwnerName,
        portrait: c.portrait || null,
        hasPortrait: !!c.portrait,
        initial: (c.name || '?').charAt(0).toUpperCase(),
        avatarColor,
        avatarBorderColor: `${avatarColor}66`,
        roleBadge: roleInfo?.badge ?? null,
        roleBadgeClass: roleInfo?.cls ?? '',
        organization: c.organization || '',
        tags: c.tags || [],
        updatedAt: c.updatedAt || c.createdAt || '',
      };
    });

    // ── Totals (always from unfiltered) ──
    const total = enriched.length;
    const burned = enriched.filter(c => c.burned).length;
    const encrypted = enriched.filter(c => c.encrypted).length;
    const linked = enriched.filter(c => c.actorId).length;

    // ── Collect unique roles for filter pills ──
    const roleSet = new Set();
    enriched.forEach(c => { if (c.roleBadge) roleSet.add(c.roleBadge); });
    const roles = [...roleSet].sort();

    // ── Apply search ──
    let filtered = enriched;
    const q = this._contactSearch?.toLowerCase().trim();
    if (q) {
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.organization && c.organization.toLowerCase().includes(q)) ||
        (c.actorName && c.actorName.toLowerCase().includes(q)) ||
        (c.playerOwnerName && c.playerOwnerName.toLowerCase().includes(q)) ||
        c.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // ── Apply filter ──
    const f = this._contactFilter;
    if (f && f !== 'all') {
      switch (f) {
        case 'linked':
          filtered = filtered.filter(c => c.actorId);
          break;
        case 'unlinked':
          filtered = filtered.filter(c => !c.actorId);
          break;
        case 'burned':
          filtered = filtered.filter(c => c.burned);
          break;
        case 'ice':
          filtered = filtered.filter(c => c.encrypted);
          break;
        case 'player':
          filtered = filtered.filter(c => c.playerOwnerName);
          break;
        default:
          // Role-based filter (case-insensitive)
          filtered = filtered.filter(c =>
            c.roleLower === f.toLowerCase() ||
            c.roleBadgeClass === f.toLowerCase() ||
            (c.roleBadge && c.roleBadge.toLowerCase() === f.toLowerCase())
          );
          break;
      }
    }

    // ── Apply sort ──
    switch (this._contactSort) {
      case 'name':
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'trust':
        filtered.sort((a, b) => b.trust - a.trust || a.name.localeCompare(b.name));
        break;
      case 'role':
        filtered.sort((a, b) => (a.roleLower || 'zzz').localeCompare(b.roleLower || 'zzz') || a.name.localeCompare(b.name));
        break;
      case 'recent':
        filtered.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        break;
    }

    return {
      total,
      burned,
      encrypted,
      linked,
      filteredCount: filtered.length,
      contacts: filtered,
      roles,
      // Pass current state for template
      contactSearch: this._contactSearch,
      contactSort: this._contactSort,
      contactFilter: this._contactFilter,
    };
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

         // Gather scenes where this network appears
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

         networks.push({
           id: net.id || net.name,
           name: net.name || net.id,
           type: known.type,
           enabled: isEnabled,
           isGlobal,
           signal: net.signalStrength ?? (isEnabled ? 85 : 0),
           noSignal: (net.signalStrength ?? (isEnabled ? 85 : 0)) === 0,
           reliability: net.reliability ?? (netId === 'deadzone' ? undefined : 85),
           userCount: net.userCount ?? 0,
           icon: known.icon,
           iconClass: known.iconClass,
           authClass,
           authIcon,
           authLabel,
           scenes,
           isCurrent: this.networkService?.currentNetworkId === (net.id || net.name),
         });
       }
     } catch (error) {
       console.error(`${MODULE_ID} | AdminPanelApp._gatherNetworkData:`, error);
     }

     return networks;
   }

  /**
   * Gather data shard summary for the Shards tab.
   * @returns {Array<object>}
   * @private
   */
  _gatherShardData() {
    const shards = [];

    try {
      const allShards = game.items?.filter(i => i.getFlag(MODULE_ID, 'isDataShard') === true) ?? [];

      for (const item of allShards) {
        const config = item.getFlag(MODULE_ID, 'config') ?? {};
        const state = item.getFlag(MODULE_ID, 'state') ?? {};

        // Determine status
        let status = 'locked';
        const hasBlackICE = config.hasBlackICE || config.blackICE;
        if (state.decrypted) {
          status = 'breached';
        } else if (hasBlackICE) {
          status = 'blackice';
        } else if (!config.encrypted && !config.requiresLogin && !config.requiresNetwork) {
          status = 'breached'; // No security = open
        }

        // Build security layer badges
        const securityLayers = [];
        if (config.requiresNetwork && config.requiredNetwork) {
          securityLayers.push({ type: 'network', label: config.requiredNetwork });
        }
        if (config.requiresLogin) {
          securityLayers.push({ type: 'password', label: 'PASSWORD' });
        }
        if (hasBlackICE) {
          securityLayers.push({ type: 'blackice', label: 'BLACK ICE' });
        }
        if (config.encrypted && config.encryptionDC) {
          securityLayers.push({ type: 'encryption', label: `DV ${config.encryptionDC}` });
        }
        if (state.decrypted) {
          securityLayers.length = 0; // Clear other layers
          securityLayers.push({ type: 'clear', label: 'DECRYPTED' });
        }
        if (securityLayers.length === 0) {
          securityLayers.push({ type: 'clear', label: 'NO SECURITY' });
        }

        // Determine icon
        let icon = 'lock', iconClass = '';
        if (hasBlackICE && !state.decrypted) {
          icon = 'skull-crossbones'; iconClass = 'ncm-shard-card__icon--blackice';
        } else if (state.decrypted || status === 'breached') {
          icon = config.encrypted ? 'lock-open' : 'folder-open';
          iconClass = 'ncm-shard-card__icon--unlocked';
        }

        // Determine owner
        let owner = 'World item';
        if (item.parent) {
          owner = `${item.parent.name}'s inventory`;
        } else if (item.compendium) {
          owner = 'Compendium';
        }

        // Count messages
        const journalId = item.getFlag(MODULE_ID, 'journalId');
        const journal = journalId ? game.journal.get(journalId) : null;
        const messageCount = journal?.pages?.size ?? 0;

        // Count attempts
        const sessions = state.sessions ?? {};
        let attemptCount = 0;
        let breachedBy = null;
        for (const [actorId, session] of Object.entries(sessions)) {
          attemptCount += session.hackAttempts ?? 0;
          if (session.loggedIn || state.decrypted) {
            const actor = game.actors.get(actorId);
            if (actor) breachedBy = actor.name;
          }
        }

        shards.push({
          itemId: item.id,
          name: item.name,
          owner,
          status,
          icon,
          iconClass,
          securityLayers,
          messageCount,
          attemptCount,
          breachedBy,
          hasBlackICE: !!hasBlackICE,
        });
      }
    } catch (error) {
      console.error(`${MODULE_ID} | AdminPanelApp._gatherShardData:`, error);
    }

    return shards;
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
   * Before render: save scroll position of current tab.
   */
  _onRender(context, options) {
    // Save scroll position before re-render
    const content = this.element?.querySelector('.ncm-admin-content');
    if (content && this._activeTab) {
      this._scrollPositions[this._activeTab] = content.scrollTop;
    }

    super._onRender(context, options);

    // Restore scroll position after render
    requestAnimationFrame(() => {
      const el = this.element?.querySelector('.ncm-admin-content');
      if (el && this._scrollPositions[this._activeTab]) {
        el.scrollTop = this._scrollPositions[this._activeTab];
      }
    });

    // ── Contacts tab: wire search + sort inputs ──
    if (this._activeTab === 'contacts') {
      this._setupContactsControls();
    }
  }

  /**
   * Wire up contacts tab search input and sort select with debounced handlers.
   */
  _setupContactsControls() {
    // Search input
    const searchInput = this.element?.querySelector('.ncm-contacts-search__input');
    if (searchInput) {
      // Focus if there's an active search
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

    // Sort select
    const sortSelect = this.element?.querySelector('.ncm-contacts-sort__select');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this._contactSort = e.target.value;
        this.render(true);
      });
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

    // Data Shards
    this.subscribe(EVENTS.SHARD_DECRYPTED, () => this._refreshIfTab('shards'));
    this.subscribe(EVENTS.SHARD_RELOCKED, () => this._refreshIfTab('shards'));
    this.subscribe(EVENTS.SHARD_HACK_ATTEMPT, () => this._refreshIfTab('shards'));
    this.subscribe(EVENTS.SHARD_CREATED, () => this._refreshIfTab('shards'));
    this.subscribe(EVENTS.SHARD_STATE_CHANGED, () => this._debouncedRender());
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

    // TODO: Implement push dialog — select target actor
    ui.notifications.info('Push contact feature coming soon.');
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

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers — Data Shards
  // ═══════════════════════════════════════════════════════════

  static _onOpenShardItem(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;

    const item = game.items.get(itemId);
    if (!item) return;

    item.sheet.render(true);
    log.info(`Admin: Opening shard ${item.name}`);
  }

  static async _onForceDecrypt(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;

    const item = game.items.get(itemId);
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

    const item = game.items.get(itemId);
    if (!item) return;

    const confirmed = await Dialog.confirm({
      title: 'Relock Shard',
      content: `<p>Relock <strong>${item.name}</strong>? All session data will be reset.</p>`,
    });
    if (!confirmed) return;

    // Atomic reset — single write
    await item.update({
      [`flags.${MODULE_ID}.state`]: { decrypted: false, sessions: {} },
    });

    ui.notifications.info(`Relocked: ${item.name}`);
    this.render(true);
  }

  static async _onConvertItem(event, target) {
    // Open item picker or dialog to select an item to convert
    // For now, use Foundry's built-in document browser
    ui.notifications.info('Select an item from your Items tab, right-click → "Convert to Data Shard".');
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
