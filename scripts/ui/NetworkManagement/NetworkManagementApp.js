/**
 * NetworkManagementApp
 * @file scripts/ui/NetworkManagement/NetworkManagementApp.js
 * @module cyberpunkred-messenger
 * @description GM-only tool for managing custom networks: create, edit, delete,
 *              configure scene availability, set authentication requirements,
 *              toggle dead zones, and review access logs.
 *
 *              Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, EVENTS, TEMPLATES, NETWORK_TYPES, SECURITY_LEVELS } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import { CreateNetworkDialog } from './CreateNetworkDialog.js';

export class NetworkManagementApp extends BaseApplication {

  /** @type {string|null} Currently selected network ID for editing */
  _selectedNetworkId = null;

  /** @type {boolean} Whether we're in "create new" mode */
  _isCreating = false;

  /** @type {string} Current tab: 'networks', 'scenes', 'logs' */
  _activeTab = 'networks';

  _isEditMode = false;
  _logFilter = 'all';

  // ─── Service Accessors ───

  get networkService() { return game.nightcity?.networkService; }
  get securityService() { return game.nightcity?.securityService; }
  get accessLogService() { return game.nightcity?.accessLogService; }

  // ─── ApplicationV2 Configuration ───

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-network-management',
    classes: ['ncm-app', 'ncm-network-management'],
    window: {
      title: 'NCM.SceneControls.NetworkManagement',
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 800,
      height: 600,
    },
    actions: {
      switchTab: NetworkManagementApp._onSwitchTab,
      selectNetwork: NetworkManagementApp._onSelectNetwork,
      createNetwork: NetworkManagementApp._onCreateNetwork,
      quickCreate: NetworkManagementApp._onQuickCreate,
      saveNetwork: NetworkManagementApp._onSaveNetwork,
      deleteNetwork: NetworkManagementApp._onDeleteNetwork,
      editNetwork: NetworkManagementApp._onEditNetwork,
      filterLogs: NetworkManagementApp._onFilterLogs,
      refreshScenes: NetworkManagementApp._onRefreshScenes,
      cancelEdit: NetworkManagementApp._onCancelEdit,
      toggleDeadZone: NetworkManagementApp._onToggleDeadZone,
      saveSceneConfig: NetworkManagementApp._onSaveSceneConfig,
      clearLogs: NetworkManagementApp._onClearLogs,
      exportLogs: NetworkManagementApp._onExportLogs,
      resetSecurity: NetworkManagementApp._onResetSecurity,
    },
  }, { inplace: false });

  static PARTS = {
    main: {
      template: TEMPLATES.NETWORK_MANAGEMENT,
    },
  };

  // ─── Data Preparation ───

  async _prepareContext(options) {
    const networks = this.networkService?.getAllNetworks() ?? [];
    const available = this.networkService?.getAvailableNetworks() ?? [];
    const currentNetId = this.networkService?.currentNetworkId;
    const currentNetwork = this.networkService?.currentNetwork ?? null;

    // ─── Header Stats ───
    const securedCount = networks.filter(n => n.security?.requiresAuth).length;
    const deadZoneScenes = (game.scenes?.contents ?? []).filter(s =>
      s.getFlag(MODULE_ID, 'deadZone')
    ).length;

    const headerStats = {
      totalNetworks: networks.length,
      activeCount: available.length,
      securedCount,
      deadZoneCount: deadZoneScenes,
    };

    // ─── Icon Options (for editor dropdown) ───
    const iconChoices = [
      'fa-wifi', 'fa-mask', 'fa-building', 'fa-tower-broadcast',
      'fa-landmark', 'fa-server', 'fa-satellite-dish', 'fa-shield-halved',
      'fa-database', 'fa-microchip', 'fa-globe', 'fa-signal',
      'fa-lock', 'fa-eye', 'fa-skull-crossbones', 'fa-robot',
    ];
    const selectedIcon = this._isCreating
      ? 'fa-wifi'
      : (this._selectedNetworkId
        ? this.networkService?.getNetwork(this._selectedNetworkId)?.theme?.icon
        : null);

    const iconOptions = iconChoices.map(ic => ({
      value: ic,
      label: ic,
      selected: ic === selectedIcon,
    }));

    // ─── Enrich Networks for sidebar ───
    const enrichedNetworks = networks.map(n => {
      const typeClass = this._getNetworkTypeClass(n);
      const signalBars = this._computeSignalBars(n.signalStrength ?? 0);
      const typeLabel = (n.type ?? 'custom').charAt(0).toUpperCase() + (n.type ?? 'custom').slice(1);

      return {
        ...n,
        isAvailable: available.some(a => a.id === n.id),
        isCurrent: n.id === currentNetId,
        isSelected: n.id === this._selectedNetworkId,
        sceneCount: this._countNetworkScenes(n),
        networkTypeClass: typeClass,
        signalBars,
        typeLabel,
      };
    });

    // ─── Selected network details ───
    let selectedNetwork = null;
    if (this._selectedNetworkId) {
      const raw = this.networkService?.getNetwork(this._selectedNetworkId);
      if (raw) {
        const typeClass = this._getNetworkTypeClass(raw);
        const typeLabel = (raw.type ?? 'custom').charAt(0).toUpperCase() + (raw.type ?? 'custom').slice(1);
        const lockoutMinutes = Math.round((raw.security?.lockoutDuration ?? 3600000) / 60000);
        const sceneCount = this._countNetworkScenes(raw);

        // Auth badge info
        const { authBadgeClass, authIcon, authLabel, authValueColor } = this._getAuthInfo(raw);

        // Signal/reliability meter classes
        const signalMeterClass = this._getMeterClass(raw.signalStrength ?? 0);
        const reliabilityMeterClass = this._getMeterClass(raw.reliability ?? 0);

        // Scene pills for availability section
        const scenePills = this._buildScenePills(raw);

        selectedNetwork = {
          ...raw,
          lockoutMinutes,
          sceneCount,
          networkTypeClass: typeClass,
          typeLabel,
          authBadgeClass,
          authIcon,
          authLabel,
          authValueColor,
          signalMeterClass,
          reliabilityMeterClass,
          scenePills,
        };
      }
    }

    // ─── Scene list ───
    const scenes = (game.scenes?.contents ?? []).map(s => ({
      id: s.id,
      name: s.name,
      isViewed: s.id === game.scenes?.viewed?.id,
      deadZone: s.getFlag(MODULE_ID, 'deadZone') ?? false,
      defaultNetwork: s.getFlag(MODULE_ID, 'defaultNetwork') ?? '',
      networkAvailability: s.getFlag(MODULE_ID, 'networkAvailability') ?? {},
    }));

    // ─── Access log entries ───
    const rawLog = this.accessLogService?.getEntries?.({ limit: 50 }) ?? [];
    const logEntries = rawLog
      .filter(e => this._logFilter === 'all' || this._matchesLogFilter(e, this._logFilter))
      .map(e => ({
        ...e,
        displayTime: this._formatLogTime(e.timestamp),
        typeIcon: this._getLogTypeIcon(e.type),
        typeClass: this._getLogTypeClass(e.type),
        actorName: e.actorName ?? game.actors?.get(e.actorId)?.name ?? 'System',
        networkName: e.networkName ?? this.networkService?.getNetwork(e.networkId)?.name ?? e.networkId ?? '—',
        message: e.message ?? e.action ?? '',
      }));

    const logStats = this.accessLogService?.getStats?.() ?? {};

    // ─── Active lockouts ───
    const lockouts = this.securityService?.getActiveLockouts?.() ?? [];
    const enrichedLockouts = lockouts.map(l => ({
      ...l,
      actorName: game.actors?.get(l.actorId)?.name ?? 'Unknown',
      targetName: this.networkService?.getNetwork(l.targetId)?.name ?? l.targetId,
      remainingMs: Math.max(0, (l.lockoutUntil ?? 0) - Date.now()),
      remainingFormatted: this._formatDuration(Math.max(0, (l.lockoutUntil ?? 0) - Date.now())),
    }));

    return {
      // Tabs
      activeTab: this._activeTab,
      isNetworksTab: this._activeTab === 'networks',
      isScenesTab: this._activeTab === 'scenes',
      isLogsTab: this._activeTab === 'logs',

      // Header
      headerStats,
      currentNetwork: currentNetwork ? {
        name: currentNetwork.name,
        id: currentNetwork.id,
      } : null,

      // Networks
      networks: enrichedNetworks,
      selectedNetwork,
      isCreating: this._isCreating,
      isEditing: this._isEditMode || this._isCreating,

      // Enums for form selects
      networkTypes: Object.entries(NETWORK_TYPES).map(([k, v]) => ({
        value: v,
        label: k.charAt(0) + k.slice(1).toLowerCase(),
      })),
      securityLevels: Object.entries(SECURITY_LEVELS).map(([k, v]) => ({
        value: v,
        label: k.charAt(0) + k.slice(1).toLowerCase(),
      })),
      iconOptions,

      // Scenes
      scenes,
      allNetworks: networks,

      // Logs
      logEntries,
      logStats,
      logCount: rawLog.length,
      logFilter: this._logFilter,

      // Lockouts
      lockouts: enrichedLockouts,
      hasLockouts: enrichedLockouts.length > 0,

      // Meta
      isGM: isGM(),
      MODULE_ID,
    };
  }

  // ─── Lifecycle ───

  _setupEventSubscriptions() {
    if (!this.eventBus) return;

    this.subscribe(EVENTS.NETWORK_CHANGED, () => this._debouncedRender());
    this.subscribe(EVENTS.NETWORK_AUTH_SUCCESS, () => this.render());
    this.subscribe(EVENTS.NETWORK_AUTH_FAILURE, () => this.render());
    this.subscribe(EVENTS.NETWORK_LOCKOUT, () => this.render());
  }

  // ─── Action Handlers ───

  static _onSwitchTab(event, target) {
    const tab = target.dataset.tab;
    if (tab) {
      this._activeTab = tab;
      this.render();
    }
  }

  static _onSelectNetwork(event, target) {
    const networkId = target.closest('[data-network-id]')?.dataset.networkId;
    if (networkId) {
      this._selectedNetworkId = networkId;
      this._isCreating = false;
      this._isEditMode = false;
      this.render();
    }
  }

  static _onCreateNetwork() {
    this._selectedNetworkId = null;
    this._isCreating = true;
    this._isEditMode = true;
    this.render();
  }

  /**
  * Open the Quick Create dialog. On success, select the new network.
  * Triggered by the "+ Quick Create" button in the sidebar header.
   */
  static async _onQuickCreate() {
  const network = await CreateNetworkDialog.show();
      if (network) {
        this._selectedNetworkId = network.id;
        this._isCreating = false;
        this._isEditMode = false;
      this.render();
    }
  }

  static async _onSaveNetwork(event, target) {
    const form = this.element.querySelector('.ncm-network-form');
    if (!form) return;

    const formData = new FormDataExtended(form).object;

    // Build network data from form
    const networkData = {
      name: formData.name?.trim(),
      type: formData.type || NETWORK_TYPES.CUSTOM,
      availability: {
        global: formData.globalAvailability === 'true' || formData.globalAvailability === true,
        scenes: [],
      },
      signalStrength: parseInt(formData.signalStrength) || 75,
      reliability: parseInt(formData.reliability) || 85,
      security: {
        level: formData.securityLevel || SECURITY_LEVELS.NONE,
        requiresAuth: formData.requiresAuth === 'true' || formData.requiresAuth === true,
        password: formData.password?.trim() ?? '',
        bypassSkills: formData.bypassSkills ? formData.bypassSkills.split(',').map(s => s.trim()).filter(Boolean) : [],
        bypassDC: parseInt(formData.bypassDC) || 15,
        maxAttempts: parseInt(formData.maxAttempts) || 3,
        lockoutDuration: (parseInt(formData.lockoutMinutes) || 60) * 60000,
      },
      effects: {
        messageDelay: parseInt(formData.messageDelay) || 0,
        traced: formData.traced === 'true' || formData.traced === true,
        anonymity: formData.anonymity === 'true' || formData.anonymity === true,
        canRoute: formData.canRoute !== 'false' && formData.canRoute !== false,
        restrictedAccess: formData.restrictedAccess === 'true' || formData.restrictedAccess === true,
        allowedRecipientNetworks: formData.allowedRecipientNetworks
          ? formData.allowedRecipientNetworks.split(',').map(s => s.trim()).filter(Boolean)
          : [],
      },
      theme: {
        color: formData.themeColor || '#19f3f7',
        icon: formData.themeIcon?.trim() || 'fa-wifi',
        glitchIntensity: parseFloat(formData.glitchIntensity) || 0.1,
      },
      description: formData.description?.trim() ?? '',
      lore: formData.lore?.trim() ?? '',
    };

    if (!networkData.name) {
      ui.notifications.warn('NCM | Network name is required.');
      return;
    }

    let result;
    if (this._isCreating) {
      result = await this.networkService.createNetwork(networkData);
      if (result.success) {
        ui.notifications.info(`NCM | Network "${networkData.name}" created.`);
        this._selectedNetworkId = result.network.id;
        this._isCreating = false;
      }
    } else if (this._selectedNetworkId) {
      result = await this.networkService.updateNetwork(this._selectedNetworkId, networkData);
      if (result.success) {
        ui.notifications.info(`NCM | Network updated.`);
      }
    }

    if (result && !result.success) {
      ui.notifications.error(`NCM | ${result.error}`);
    }

    this.render();
  }

  /**
   * Switch from detail view to editor mode for the selected network.
   * Triggered by the "Edit" button in the detail header.
   */
  static _onEditNetwork() {
    if (!this._selectedNetworkId) return;
    const net = this.networkService?.getNetwork(this._selectedNetworkId);
    if (!net) return;
    this._isEditMode = true;
    this.render();
  }

  /**
   * Apply log filter.
   */
  static _onFilterLogs(event, target) {
    const filter = target.dataset.filter;
    if (filter) {
      this._logFilter = filter;
      this.render();
    }
  }

  /**
   * Refresh the scenes tab.
   */
  static _onRefreshScenes() {
    this.render();
  }

  static async _onDeleteNetwork(event, target) {
    const networkId = this._selectedNetworkId;
    if (!networkId) return;

    const network = this.networkService.getNetwork(networkId);
    if (!network) return;

    const confirmed = await Dialog.confirm({
      title: 'Delete Network',
      content: `<p>Delete network <strong>${network.name}</strong>? This cannot be undone.</p>`,
    });
    if (!confirmed) return;

    const result = await this.networkService.deleteNetwork(networkId);
    if (result.success) {
      ui.notifications.info(`NCM | Network "${network.name}" deleted.`);
      this._selectedNetworkId = null;
    } else {
      ui.notifications.error(`NCM | ${result.error}`);
    }

    this.render();
  }

  static _onCancelEdit() {
    this._isEditMode = false;
    if (this._isCreating) {
      this._isCreating = false;
      this._selectedNetworkId = null;
    }
    this.render();
  }

  static async _onToggleDeadZone(event, target) {
    const sceneId = target.closest('[data-scene-id]')?.dataset.sceneId;
    if (!sceneId) return;

    const scene = game.scenes.get(sceneId);
    const currentDead = scene?.getFlag(MODULE_ID, 'deadZone') ?? false;
    await this.networkService.toggleDeadZone(sceneId, !currentDead);
    this.render();
  }

  static async _onSaveSceneConfig(event, target) {
    const sceneId = target.closest('[data-scene-id]')?.dataset.sceneId;
    if (!sceneId) return;

    const sceneRow = this.element.querySelector(`[data-scene-id="${sceneId}"]`);
    if (!sceneRow) return;

    // Read default network
    const defaultSelect = sceneRow.querySelector('[name="defaultNetwork"]');
    const defaultNetwork = defaultSelect?.value || '';

    // Read network availability checkboxes
    const checkboxes = sceneRow.querySelectorAll('[name^="netAvail_"]');
    const availability = {};
    for (const cb of checkboxes) {
      const netId = cb.name.replace('netAvail_', '');
      availability[netId] = cb.checked;
    }

    await this.networkService.setSceneDefaultNetwork(sceneId, defaultNetwork);
    await this.networkService.setSceneNetworkAvailability(sceneId, availability);

    ui.notifications.info('NCM | Scene network config saved.');
    this.render();
  }

  static _onClearLogs() {
    this.accessLogService?.clearLog();
    ui.notifications.info('NCM | Access log cleared.');
    this.render();
  }

  static _onExportLogs() {
    const json = this.accessLogService?.exportLog();
    if (!json) return;

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-access-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  static _onResetSecurity(event, target) {
    const actorId = target.dataset.actorId;
    const targetId = target.dataset.targetId;
    if (actorId && targetId) {
      this.securityService?.resetState(actorId, targetId);
      ui.notifications.info('NCM | Security state reset.');
      this.render();
    }
  }

  // ─── Display Helpers ───

  _formatDuration(ms) {
    if (ms <= 0) return '0s';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  _formatLogTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  _getLogTypeIcon(type) {
    const icons = {
      connect: 'fa-plug',
      disconnect: 'fa-plug-circle-xmark',
      auth_success: 'fa-lock-open',
      auth_failure: 'fa-lock',
      lockout: 'fa-ban',
      dead_zone: 'fa-signal',
      network_switch: 'fa-arrows-rotate',
    };
    return icons[type] ?? 'fa-circle-info';
  }

  _getLogTypeLabel(type) {
    const labels = {
      connect: 'Connected',
      disconnect: 'Disconnected',
      auth_success: 'Auth Success',
      auth_failure: 'Auth Failed',
      lockout: 'Lockout',
      dead_zone: 'Dead Zone',
      network_switch: 'Network Switch',
    };
    return labels[type] ?? type;
  }

  /**
   * Compute signal bar states for the sidebar list.
   * Returns array of 4 bars with height, active state, and level class.
   * @param {number} signal - 0-100
   * @returns {Array<{height: number, active: boolean, level: string}>}
   */
  _computeSignalBars(signal) {
    const heights = [4, 7, 10, 14];
    const activeBars = signal >= 75 ? 4
      : signal >= 50 ? 3
      : signal >= 25 ? 2
      : signal > 0  ? 1
      : 0;

    const level = signal >= 60 ? 'high'
      : signal >= 30 ? 'med'
      : signal > 0   ? 'low'
      : 'dead';

    return heights.map((h, i) => ({
      height: h,
      active: i < activeBars,
      level: i < activeBars ? level : '',
    }));
  }

  /**
   * Map network to a CSS type class for icon styling.
   * Uses network ID for core networks, falls back to type.
   * @param {object} net
   * @returns {string}
   */
  _getNetworkTypeClass(net) {
    // Core network IDs get direct mappings
    const idMap = {
      'CITINET': 'citinet',
      'citinet': 'citinet',
      'DARKNET': 'darknet',
      'darknet': 'darknet',
      'CORPNET': 'corpnet',
      'corpnet': 'corpnet',
      'GOVNET': 'govnet',
      'govnet': 'govnet',
      'DATA_POOL': 'citinet',
      'dead_zone': 'deadzone',
      'DEAD_ZONE': 'deadzone',
    };
    if (idMap[net.id]) return idMap[net.id];

    // Type-based fallback
    const typeMap = {
      'public': 'citinet',
      'PUBLIC': 'citinet',
      'hidden': 'darknet',
      'HIDDEN': 'darknet',
      'underground': 'darknet',
      'UNDERGROUND': 'darknet',
      'corporate': 'corpnet',
      'CORPORATE': 'corpnet',
      'government': 'govnet',
      'GOVERNMENT': 'govnet',
    };
    return typeMap[net.type] || 'custom';
  }

  /**
   * Get meter fill class based on percentage.
   * @param {number} value - 0-100
   * @returns {string} 'high', 'med', or 'low'
   */
  _getMeterClass(value) {
    if (value >= 60) return 'high';
    if (value >= 30) return 'med';
    return 'low';
  }

  /**
   * Get auth badge info for detail view.
   * @param {object} net
   * @returns {{authBadgeClass: string, authIcon: string, authLabel: string, authValueColor: string}}
   */
  _getAuthInfo(net) {
    if (!net.security?.requiresAuth) {
      return {
        authBadgeClass: 'open',
        authIcon: 'fa-lock-open',
        authLabel: 'Open Access',
        authValueColor: 'green',
      };
    }

    if (net.security.password) {
      return {
        authBadgeClass: 'password',
        authIcon: 'fa-key',
        authLabel: 'Password Required',
        authValueColor: 'gold',
      };
    }

    return {
      authBadgeClass: 'skill',
      authIcon: 'fa-brain',
      authLabel: 'Skill Check Required',
      authValueColor: 'purple',
    };
  }

  /**
   * Build scene pills for the availability section in detail view.
   * @param {object} net
   * @returns {Array<{name: string, isCurrent: boolean}>}
   */
  _buildScenePills(net) {
    if (net.availability?.global) return []; // Global shown separately

    const pills = [];
    const sceneAvailMap = {};

    // Check all scenes for this network's availability
    for (const scene of game.scenes?.contents ?? []) {
      const avail = scene.getFlag(MODULE_ID, 'networkAvailability') ?? {};
      if (avail[net.id]) {
        pills.push({
          name: scene.name,
          isCurrent: scene.id === game.scenes?.viewed?.id,
        });
      }
    }

    // Also include scenes from the network's own availability.scenes array
    for (const sceneId of net.availability?.scenes ?? []) {
      if (!pills.some(p => p.name === game.scenes?.get(sceneId)?.name)) {
        const scene = game.scenes?.get(sceneId);
        if (scene) {
          pills.push({
            name: scene.name,
            isCurrent: scene.id === game.scenes?.viewed?.id,
          });
        }
      }
    }

    return pills;
  }

  /**
   * Count how many scenes this network is available in.
   * @param {object} net
   * @returns {number}
   */
  _countNetworkScenes(net) {
    if (net.availability?.global) return game.scenes?.contents?.length ?? 0;

    let count = 0;
    for (const scene of game.scenes?.contents ?? []) {
      const avail = scene.getFlag(MODULE_ID, 'networkAvailability') ?? {};
      if (avail[net.id]) count++;
    }
    // Include explicit scene IDs too
    count = Math.max(count, net.availability?.scenes?.length ?? 0);
    return count;
  }

  /**
   * Get log entry type CSS class.
   * @param {string} type
   * @returns {string}
   */
  _getLogTypeClass(type) {
    const map = {
      'auth_success': 'success',
      'auth_failure': 'fail',
      'auth_fail': 'fail',
      'switch': 'switch',
      'connect': 'success',
      'disconnect': 'fail',
      'lockout': 'lockout',
      'dead_zone': 'deadzone',
      'hack': 'auth',
      'system': 'system',
    };
    return map[type] || 'switch';
  }

  /**
   * Check if a log entry matches the current filter.
   * @param {object} entry
   * @param {string} filter
   * @returns {boolean}
   */
  _matchesLogFilter(entry, filter) {
    const filterMap = {
      'auth': ['auth_success', 'auth_failure', 'auth_fail'],
      'switch': ['switch', 'connect', 'disconnect'],
      'lockout': ['lockout'],
      'hack': ['hack'],
    };
    return (filterMap[filter] ?? []).includes(entry.type);
  }

}
