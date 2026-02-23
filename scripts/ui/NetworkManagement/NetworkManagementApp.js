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

export class NetworkManagementApp extends BaseApplication {

  /** @type {string|null} Currently selected network ID for editing */
  _selectedNetworkId = null;

  /** @type {boolean} Whether we're in "create new" mode */
  _isCreating = false;

  /** @type {string} Current tab: 'networks', 'scenes', 'logs' */
  _activeTab = 'networks';

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
      saveNetwork: NetworkManagementApp._onSaveNetwork,
      deleteNetwork: NetworkManagementApp._onDeleteNetwork,
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

    // Selected network details
    let selectedNetwork = null;
    if (this._selectedNetworkId) {
      const raw = this.networkService?.getNetwork(this._selectedNetworkId);
      if (raw) {
        selectedNetwork = {
          ...raw,
          lockoutMinutes: Math.round((raw.security?.lockoutDuration ?? 3600000) / 60000),
        };
      }
    }

    // Scene list for scene tab
    const scenes = game.scenes?.contents.map(s => ({
      id: s.id,
      name: s.name,
      isViewed: s.id === game.scenes.viewed?.id,
      deadZone: s.getFlag(MODULE_ID, 'deadZone') ?? false,
      defaultNetwork: s.getFlag(MODULE_ID, 'defaultNetwork') ?? '',
      networkAvailability: s.getFlag(MODULE_ID, 'networkAvailability') ?? {},
    })) ?? [];

    // Access log entries
    const logEntries = this.accessLogService?.getEntries({ limit: 50 }) ?? [];
    const logStats = this.accessLogService?.getStats() ?? {};

    // Active lockouts
    const lockouts = this.securityService?.getActiveLockouts() ?? [];
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

      // Networks
      networks: networks.map(n => ({
        ...n,
        isAvailable: available.some(a => a.id === n.id),
        isCurrent: n.id === currentNetId,
        isSelected: n.id === this._selectedNetworkId,
        sceneCount: n.availability.scenes?.length ?? 0,
      })),

      selectedNetwork,
      isCreating: this._isCreating,
      isEditing: !!this._selectedNetworkId || this._isCreating,

      // Enums for form selects
      networkTypes: Object.entries(NETWORK_TYPES).map(([k, v]) => ({ value: v, label: k })),
      securityLevels: Object.entries(SECURITY_LEVELS).map(([k, v]) => ({ value: v, label: k })),

      // Scenes
      scenes,
      allNetworks: networks,

      // Logs
      logEntries: logEntries.map(e => ({
        ...e,
        displayTime: this._formatLogTime(e.timestamp),
        typeIcon: this._getLogTypeIcon(e.type),
        typeLabel: this._getLogTypeLabel(e.type),
      })),
      logStats,
      logCount: this.accessLogService?.entryCount ?? 0,

      // Security
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

    this.subscribe(EVENTS.NETWORK_CHANGED, () => this.render());
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
      this.render();
    }
  }

  static _onCreateNetwork() {
    this._selectedNetworkId = null;
    this._isCreating = true;
    this.render();
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
    this._selectedNetworkId = null;
    this._isCreating = false;
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
}
