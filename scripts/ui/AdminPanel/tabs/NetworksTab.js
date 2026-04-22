/**
 * NetworksTab — War Room (cards + mixer) and full activity log subview.
 * @file scripts/ui/AdminPanel/tabs/NetworksTab.js
 * @module cyberpunkred-messenger
 *
 * Tab-local state covers cards/logs subview, search/filter/group, mixer,
 * connected players, scene quick strip, expanded log rows, manual log entry
 * form, and per-card log expansion.
 *
 * Cross-parent dependencies:
 *   - this.app.constructor._findItem(id)        — log link → shard
 *   - this.app._pendingContentScrollReset       — set when switching subview
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { log } from '../../../utils/helpers.js';
import { BaseTab } from '../BaseTab.js';

export class NetworksTab extends BaseTab {

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  /** @type {'cards'|'logs'} */
  _subView = 'cards';
  /** @type {Set<string>} Network IDs with expanded inline logs */
  _expandedLogs = new Set();
  /** @type {string} Log type filter */
  _logTypeFilter = 'all';
  /** @type {string} Log network filter ('' = all) */
  _logNetworkFilter = '';
  /** @type {boolean} Show add-log form */
  _showAddLogForm = false;
  /** @type {string} Network search query */
  _search = '';
  _authFilter = 'all';
  _statusFilter = 'all';
  _groupFilter = 'all';
  /** @type {Set<string>} Collapsed network group keys */
  _collapsedGroups = new Set();
  _searchHandler = null;

  get key() { return 'networks'; }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  prepareContext() {
    const networks = this._gatherData();
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

    const connectedPlayers = this._gatherConnectedPlayers(networks);
    const sceneStrip = this._gatherSceneStrip();

    const allNetworks = this.networkService?.getAllNetworks?.() ?? [];
    const netStats = {
      total: allNetworks.length,
      active: networks.filter(n => n.enabled).length,
      deadZones: sceneStrip.filter(s => s.deadZone).length,
      secured: allNetworks.filter(n => n.security?.requiresAuth).length,
      connected: game.users?.filter(u => u.active && !u.isGM)?.length ?? 0,
    };

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

    return {
      networks,
      connectedPlayers,
      networkGroups: this._buildGroups(this._filter(networks)),
      networkSummary,
      sceneStrip,
      netStats,
      networkSubView: this._subView,
      networkSearchQuery: this._search,
      netAuthFilter: this._authFilter,
      netStatusFilter: this._statusFilter,
      netGroupFilter: this._groupFilter,
      fullLogEntries,
      logTypeFilters,
      logNetworkFilter: this._logNetworkFilter,
      showAddLogForm: this._showAddLogForm,
      logEntryCount: this.accessLogService?.entryCount ?? 0,
    };
  }

  onRender(context, options) {
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
      if (this._search) {
        searchInput.value = this._search;
        searchInput.focus();
        const len = this._search.length;
        searchInput.setSelectionRange(len, len);
      }

      const handler = this._searchHandler || (this._searchHandler =
        foundry.utils.debounce((e) => {
          this._search = e.target.value;
          this.render(true);
        }, 350)
      );
      searchInput.removeEventListener('input', handler);
      searchInput.addEventListener('input', handler);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Private Helpers — data gathering
  // ═══════════════════════════════════════════════════════════

  _gatherData() {
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
       console.error(`${MODULE_ID} | NetworksTab._gatherData:`, error);
     }

     return networks;
   }

  _filter(networks) {
    let filtered = networks;

    // Text search
    if (this._search) {
      const q = this._search.toLowerCase();
      filtered = filtered.filter(n => n.name.toLowerCase().includes(q));
    }

    // Auth filter
    if (this._authFilter !== 'all') {
      filtered = filtered.filter(n => n.authClass === this._authFilter);
    }

    // Status filter
    if (this._statusFilter !== 'all') {
      if (this._statusFilter === 'active') filtered = filtered.filter(n => n.enabled);
      else if (this._statusFilter === 'disabled') filtered = filtered.filter(n => !n.enabled);
    }

    // Group filter
    if (this._groupFilter !== 'all') {
      if (this._groupFilter === 'core') filtered = filtered.filter(n => n.isCore);
      else if (this._groupFilter === 'custom') filtered = filtered.filter(n => !n.isCore);
    }

    return filtered;
  }

  _buildGroups(filteredNetworks) {
    const groups = [];

    // Core networks first
    const coreNets = filteredNetworks.filter(n => n.isCore);
    if (coreNets.length) {
      groups.push({
        name: 'Core Subnets',
        key: '_core',
        icon: 'fa-server',
        iconClass: '',
        collapsed: this._collapsedGroups.has('_core'),
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
        collapsed: this._collapsedGroups.has(`grp_${gName}`),
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
        collapsed: this._collapsedGroups.has('_ungrouped'),
        networks: ungrouped,
        count: ungrouped.length,
      });
    }

    return groups;
  }

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

  _gatherFullLogEntries() {
    if (this._subView !== 'logs') return [];

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

  _formatLogTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  }

  _formatLogDate(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}.${d.getUTCFullYear()}`;
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers
  // ═══════════════════════════════════════════════════════════

  async onToggle(event, target) {
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

  onOpenManager(event, target) {
    game.nightcity?.openNetworkManager?.();
    log.info('Admin: Opening Network Manager');
  }

  onEditInManager(event, target) {
    const networkId = target.dataset.networkId || target.closest('[data-network-id]')?.dataset.networkId;
    if (!networkId) {
      game.nightcity?.openNetworkManager?.();
      return;
    }

    game.nightcity?.openNetworkManagerToNetwork?.(networkId);
    log.info(`Admin: Opening Network Manager → ${networkId}`);
  }

  onOpenManagerLogs(event, target) {
    game.nightcity?.openNetworkManagerToLogs?.();
    log.info('Admin: Opening Network Manager → Logs tab');
  }

  onCreate(event, target) {
    game.nightcity?.openNetworkManagerToCreate?.();
    log.info('Admin: Opening Network Manager → Create mode');
  }

  async onDelete(event, target) {
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

  onToggleGroup(event, target) {
    const groupKey = target.dataset.groupKey || target.closest('[data-group-key]')?.dataset.groupKey;
    if (!groupKey) return;
    if (this._collapsedGroups.has(groupKey)) {
      this._collapsedGroups.delete(groupKey);
    } else {
      this._collapsedGroups.add(groupKey);
    }
    this.render(true);
  }

  async onToggleSceneDeadZone(event, target) {
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

  onSwitchSubView(event, target) {
    const subview = target.dataset.subview || target.closest('[data-subview]')?.dataset.subview;
    if (!subview) return;
    this._subView = subview;
    this.app._pendingContentScrollReset = true;
    this.render(true);
  }

  onToggleCardLog(event, target) {
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

  onDeleteLogEntry(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const entryId = target.dataset.entryId || target.closest('[data-entry-id]')?.dataset.entryId;
    if (!entryId) return;
    if (this.accessLogService?.deleteEntry(entryId)) {
      ui.notifications.info('NCM | Log entry deleted.');
      this.render(true);
    }
  }

  onEditLogEntry(event, target) {
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

  onOpenLogReference(event, target) {
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
      const item = this.app.constructor._findItem(itemId);
      if (item) {
        game.nightcity?.messenger?.forceOpenDataShard?.(item);
      } else {
        ui.notifications.warn('NCM | Could not find the referenced data shard.');
      }
    }
  }

  onFilterLogType(event, target) {
    const filter = target.dataset.filter || target.closest('[data-filter]')?.dataset.filter;
    if (!filter) return;
    this._logTypeFilter = filter;
    this.render(true);
  }

  onToggleAddLogForm() {
    this._showAddLogForm = !this._showAddLogForm;
    this.render(true);
  }

  onAddManualLogEntry(event, target) {
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

  onExportLogs() {
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

  onExportFormattedLogs() {
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

  onImportLogs() {
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

  onClearLogs() {
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

  onResetAuth(event, target) {
    const networkId = target.dataset.networkId || target.closest('[data-network-id]')?.dataset.networkId;
    if (!networkId) return;
    this.networkService?.revokeAuth(networkId);
    ui.notifications.info(`NCM | Auth reset for ${networkId}.`);
    this.render(true);
  }

  async onSendBroadcast(event, target) {
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

  onScrollMixerLeft(event, target) {
    const strip = this.element?.querySelector('.ncm-mixer-strip');
    if (strip) strip.scrollBy({ left: -200, behavior: 'smooth' });
  }

  onScrollMixerRight(event, target) {
    const strip = this.element?.querySelector('.ncm-mixer-strip');
    if (strip) strip.scrollBy({ left: 200, behavior: 'smooth' });
  }

  onCycleAuthFilter() {
    const order = ['all', 'open', 'password', 'skill', 'locked', 'blocked'];
    const idx = order.indexOf(this._authFilter);
    this._authFilter = order[(idx + 1) % order.length];
    this.render();
  }

  onCycleStatusFilter() {
    const order = ['all', 'active', 'disabled'];
    const idx = order.indexOf(this._statusFilter);
    this._statusFilter = order[(idx + 1) % order.length];
    this.render();
  }

  onCycleGroupFilter() {
    const order = ['all', 'core', 'custom'];
    const idx = order.indexOf(this._groupFilter);
    this._groupFilter = order[(idx + 1) % order.length];
    this.render();
  }
}
