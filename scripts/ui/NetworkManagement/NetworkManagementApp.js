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
import { showWorldItemPicker } from '../../utils/itemPicker.js';

export class NetworkManagementApp extends BaseApplication {

  /** @type {string|null} Currently selected network ID for editing */
  _selectedNetworkId = null;

  /** @type {boolean} Whether we're in "create new" mode */
  _isCreating = false;

  /** @type {string} Current tab: 'networks', 'scenes', 'logs' */
  _activeTab = 'networks';

  _isEditMode = false;
  _logFilter = 'all';
  _logNetworkFilter = '';
  _showAddLogForm = false;

  /** @type {string} Search query for subnet sidebar */
  _networkSearch = '';

  /** @type {Set<string>} Collapsed group names in sidebar */
  _collapsedGroups = new Set();

  /** @type {string|null} Currently selected scene in Scenes tab */
  _selectedSceneId = null;

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
      toggleAddLogForm: NetworkManagementApp._onToggleAddLogForm,
      addManualLogEntry: NetworkManagementApp._onAddManualLogEntry,
      editLogEntry: NetworkManagementApp._onEditLogEntry,
      deleteLogEntry: NetworkManagementApp._onDeleteLogEntry,
      browseKeyItem: NetworkManagementApp._onBrowseKeyItem,
      searchKeyItem: NetworkManagementApp._onSearchKeyItem,
      clearKeyItem: NetworkManagementApp._onClearKeyItem,
      browseCustomImage: NetworkManagementApp._onBrowseCustomImage,
      selectIceSource: NetworkManagementApp._onSelectIceSource,
      selectIceActor: NetworkManagementApp._onSelectIceActor,
      selectIconMode: NetworkManagementApp._onSelectIconMode,
      selectIcon: NetworkManagementApp._onSelectIcon,
      applyPreset: NetworkManagementApp._onApplyPreset,
      resetSecurity: NetworkManagementApp._onResetSecurity,
      toggleSidebarGroup: NetworkManagementApp._onToggleSidebarGroup,
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

    // ─── Search filter ───
    const filteredNetworks = this._networkSearch
      ? enrichedNetworks.filter(n => n.name.toLowerCase().includes(this._networkSearch.toLowerCase()))
      : enrichedNetworks;

    // ─── Group networks for sidebar ───
    const existingGroups = [...new Set(
      networks.map(n => n.group).filter(g => g && g.trim())
    )].sort();

    const networkGroups = [];
    // Core networks always first
    const coreNets = filteredNetworks.filter(n => n.isCore);
    if (coreNets.length) {
      networkGroups.push({
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
      networkGroups.push({
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
      networkGroups.push({
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
      isCurrent: s.id === canvas.scene?.id,
      deadZone: s.getFlag(MODULE_ID, 'deadZone') ?? false,
      defaultNetwork: s.getFlag(MODULE_ID, 'defaultNetwork') ?? '',
      networkAvailability: s.getFlag(MODULE_ID, 'networkAvailability') ?? {},
    }));

    // Auto-select current scene if nothing selected
    if (!this._selectedSceneId && scenes.length) {
      const current = scenes.find(s => s.isCurrent);
      this._selectedSceneId = current?.id ?? scenes[0].id;
    }

    const selectedScene = scenes.find(s => s.id === this._selectedSceneId) ?? null;

    // Scene summary stats
    const sceneSummary = {
      total: scenes.length,
      deadZones: scenes.filter(s => s.deadZone).length,
      configured: scenes.filter(s => s.defaultNetwork).length,
    };

    // ─── Access log entries ───
    const logFilters = { limit: 100 };
    if (this._logNetworkFilter) logFilters.networkId = this._logNetworkFilter;

    let rawLog = this.accessLogService?.getEntries?.(logFilters) ?? [];

    // Apply type and manual filters
    rawLog = rawLog.filter(e => {
      if (this._logFilter === 'all') return true;
      if (this._logFilter === 'manual') return e.manual === true;
      return this._matchesLogFilter(e, this._logFilter);
    });

    const logEntries = rawLog.map(e => ({
        ...e,
        displayTime: this._formatLogTime(e.timestamp),
        displayDate: this._formatLogDate(e.timestamp),
        typeIcon: this._getLogTypeIcon(e.type),
        typeClass: this._getLogTypeClass(e.type),
        typeLabel: this._getLogTypeLabel(e.type),
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
      networkGroups,
      existingGroups,
      networkSearch: this._networkSearch,
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

      // ICE config (for selected network)
      isLethalICE: selectedNetwork?.security?.encryptionType === 'BLACK_ICE' || selectedNetwork?.security?.encryptionType === 'RED_ICE',
      iceSource: selectedNetwork?.security?.ice?.source ?? 'default',
      iceSourceDefault: (selectedNetwork?.security?.ice?.source ?? 'default') === 'default',
      iceSourceCustom: selectedNetwork?.security?.ice?.source === 'custom',
      iceSourceActor: selectedNetwork?.security?.ice?.source === 'actor',
      blackIceActors: (game.actors?.filter(a =>
        a.type === 'blackIce' || a.type === 'black-ice' ||
        a.getFlag?.(MODULE_ID, 'isBlackICE') ||
        a.name?.toLowerCase().includes('black ice')
      ) ?? []).map(a => ({
        id: a.id, name: a.name, img: a.img,
        atk: a.system?.stats?.atk ?? 0,
        selected: selectedNetwork?.security?.ice?.actorId === a.id,
      })),

      // Icon mode
      iconMode: selectedNetwork?.theme?.iconMode || 'fa',
      isIconModeFa: (selectedNetwork?.theme?.iconMode || 'fa') === 'fa',
      isIconModeImage: selectedNetwork?.theme?.iconMode === 'image',

      // Presets (for create mode)
      presets: [
        { key: 'fixer_den', label: 'Fixer Den', icon: 'fa-handshake', color: '#F65261' },
        { key: 'corp_office', label: 'Corp Office', icon: 'fa-building', color: '#f7c948' },
        { key: 'gang_turf', label: 'Gang Turf', icon: 'fa-skull', color: '#ff0033' },
        { key: 'secure_facility', label: 'Secure Facility', icon: 'fa-shield-halved', color: '#19f3f7' },
        { key: 'blank', label: 'Blank', icon: 'fa-circle-dot', color: '#8888a0' },
      ],

      // Key item display
      keyItemName: selectedNetwork?.security?.keyItemName || '',
      keyItemImg: selectedNetwork?.security?.keyItemImg || '',
      hasKeyItem: !!(selectedNetwork?.security?.keyItemName),

      // Scenes
      scenes,
      selectedScene,
      selectedSceneId: this._selectedSceneId,
      sceneSummary,
      allNetworks: networks,

      // Logs
      logEntries,
      logStats,
      logCount: rawLog.length,
      logFilter: this._logFilter,
      logNetworkFilter: this._logNetworkFilter,
      showAddLogForm: this._showAddLogForm,

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

  _onRender(context, options) {
    super._onRender?.(context, options);

    // Wire log network filter select (can't use data-action on <select>)
    const netFilter = this.element?.querySelector('.ncm-netmgr__log-network-filter');
    if (netFilter) {
      netFilter.addEventListener('change', (e) => {
        this._logNetworkFilter = e.target.value;
        this.render(true);
      });
    }

    // Wire scene selector dropdown
    const sceneSelect = this.element?.querySelector('.ncm-netmgr__scene-selector');
    if (sceneSelect) {
      sceneSelect.addEventListener('change', (e) => {
        this._selectedSceneId = e.target.value;
        this.render(true);
      });
    }

    // Wire sidebar search input
    const searchInput = this.element?.querySelector('.ncm-netmgr__sidebar-search');
    if (searchInput) {
      if (this._networkSearch) searchInput.focus();
      const handler = this._sidebarSearchHandler || (this._sidebarSearchHandler =
        foundry.utils.debounce((e) => {
          this._networkSearch = e.target.value;
          this.render(true);
        }, 200)
      );
      searchInput.removeEventListener('input', handler);
      searchInput.addEventListener('input', handler);
    }

    // ─── Editor: ICE type → show/hide ICE source section ───
    const iceTypeSel = this.element?.querySelector('[name="encryptionType"]');
    if (iceTypeSel) {
      iceTypeSel.addEventListener('change', () => this._updateIceVisibility());
      this._updateIceVisibility(); // sync initial state
    }

    // Wire live preview bindings for icon grid, color, group pills, custom image
    this._wireEditorLiveBindings();
  }

  /** Show/hide ICE source section based on encryptionType select */
  _updateIceVisibility() {
    const el = this.element;
    if (!el) return;
    const iceType = el.querySelector('[name="encryptionType"]')?.value || 'ICE';
    const isLethal = iceType === 'BLACK_ICE' || iceType === 'RED_ICE';
    const iceSource = el.querySelector('[data-ice-source]');
    if (iceSource) iceSource.style.display = isLethal ? 'block' : 'none';
  }

  /**
   * Wire live preview updates for icon, color, group pills, and custom image.
   */
  _wireEditorLiveBindings() {
    const el = this.element;
    if (!el) return;

    // ─── Color swatch → update icon preview ───
    const colorSwatch = el.querySelector('[data-color-swatch]');
    const colorText = el.querySelector('[data-color-text]');
    const iconPreview = el.querySelector('[data-icon-preview]');
    const syncColor = () => {
      const hex = colorSwatch?.value || colorText?.value || '#19f3f7';
      if (iconPreview) {
        iconPreview.style.color = hex;
        iconPreview.style.background = `${hex}14`;
        iconPreview.style.borderColor = `${hex}26`;
      }
      if (colorSwatch && colorText && document.activeElement === colorSwatch) colorText.value = hex;
      if (colorSwatch && colorText && document.activeElement === colorText) {
        if (/^#[0-9a-fA-F]{6}$/.test(colorText.value)) colorSwatch.value = colorText.value;
      }
    };
    colorSwatch?.addEventListener('input', syncColor);
    colorText?.addEventListener('input', syncColor);

    // ─── Group pills ───
    el.querySelectorAll('[data-group-value]')?.forEach(pill => {
      pill.addEventListener('click', () => {
        const groupInput = el.querySelector('[data-group-input]');
        const value = pill.dataset.groupValue;
        // Toggle: click same pill again to deselect
        const wasActive = pill.classList.contains('active');
        el.querySelectorAll('[data-group-value]').forEach(p => p.classList.remove('active'));
        if (!wasActive) {
          pill.classList.add('active');
          if (groupInput) groupInput.value = value;
        } else {
          if (groupInput) groupInput.value = '';
        }
      });
    });
    // + button focuses the input
    el.querySelector('[data-group-add]')?.addEventListener('click', () => {
      const groupInput = el.querySelector('[data-group-input]');
      el.querySelectorAll('[data-group-value]').forEach(p => p.classList.remove('active'));
      if (groupInput) { groupInput.value = ''; groupInput.focus(); }
    });

    // ─── Custom image path → update preview ───
    const customImgInput = el.querySelector('[data-custom-img-input]');
    const customImgPreview = el.querySelector('[data-custom-img-preview]');
    if (customImgInput && customImgPreview) {
      customImgInput.addEventListener('change', () => {
        const path = customImgInput.value.trim();
        customImgPreview.innerHTML = path
          ? `<img src="${path}" alt="" style="width:100%;height:100%;object-fit:contain;">`
          : '<i class="fas fa-image"></i>';
      });
    }
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

    // Read all values directly from DOM — FormDataExtended is unreliable
    // with selects and checkboxes in ApplicationV2
    const val = (name) => form.querySelector(`[name="${name}"]`)?.value?.trim() ?? '';
    const num = (name, def) => parseInt(form.querySelector(`[name="${name}"]`)?.value) || def;
    const flt = (name, def) => parseFloat(form.querySelector(`[name="${name}"]`)?.value) || def;
    const chk = (name) => form.querySelector(`input[name="${name}"]`)?.checked ?? false;
    const sel = (name) => form.querySelector(`select[name="${name}"]`)?.value ?? '';

    // Build network data from form
    const networkData = {
      name: val('name'),
      type: sel('type') || NETWORK_TYPES.CUSTOM,
      availability: {
        global: chk('globalAvailability'),
        scenes: [],
      },
      signalStrength: num('signalStrength', 75),
      reliability: num('reliability', 85),
      security: {
        level: sel('securityLevel') || SECURITY_LEVELS.NONE,
        requiresAuth: sel('requiresAuth') === 'true',
        password: val('password'),
        allowPassword: chk('allowPassword'),
        allowSkillCheck: chk('allowSkillCheck'),
        authLogic: sel('authLogic') || 'any',
        bypassSkills: val('bypassSkills') ? val('bypassSkills').split(',').map(s => s.trim()).filter(Boolean) : [],
        bypassDC: num('bypassDC', 15),
        allowKeyItem: chk('allowKeyItem'),
        keyItemName: val('keyItemName'),
        keyItemTag: val('keyItemTag'),
        keyItemImg: val('keyItemImg'),
        keyItemConsume: chk('keyItemConsume'),
        maxAttempts: num('maxAttempts', 3),
        lockoutDuration: (num('lockoutMinutes', 60)) * 60000,
        encryptionType: sel('encryptionType') || 'ICE',
        failureMode: sel('failureMode') || 'lockout',
        ice: {
          source: val('iceSource') || 'default',
          actorId: val('iceActorId') || null,
          customName: val('iceCustomName') || '',
          customPortrait: val('iceCustomPortrait') || '',
          customDamage: val('iceCustomDamage') || '',
        },
      },
      effects: {
        messageDelay: num('messageDelay', 0),
        traced: chk('traced'),
        anonymity: chk('anonymity'),
        canRoute: chk('canRoute'),
        restrictedAccess: chk('restrictedAccess'),
        allowedRecipientNetworks: val('allowedRecipientNetworks')
          ? val('allowedRecipientNetworks').split(',').map(s => s.trim()).filter(Boolean)
          : [],
      },
      theme: {
        color: (val('iconMode') === 'image' ? val('themeColorImg') : val('themeColor')) || '#19f3f7',
        icon: val('themeIcon') || 'fa-wifi',
        iconMode: val('iconMode') || 'fa',
        customImage: val('customImage') || '',
        glitchIntensity: val('iconMode') === 'image' ? flt('glitchIntensityImg', 0.1) : flt('glitchIntensity', 0.1),
      },
      description: val('description'),
      lore: val('lore'),
      group: val('group'),
    };

    // Debug log to verify authLogic is captured
    console.log(`NCM | Save network — authLogic: "${networkData.security.authLogic}", allowPassword: ${networkData.security.allowPassword}, allowSkillCheck: ${networkData.security.allowSkillCheck}, allowKeyItem: ${networkData.security.allowKeyItem}`);

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

  /**
   * Browse world items — legacy fallback.
   */
  static async _onBrowseKeyItem(event, target) {
    return NetworkManagementApp._onSearchKeyItem.call(this, event, target);
  }

  /**
   * Card-based key item picker (matches shard config pattern).
   */
  static async _onSearchKeyItem(event, target) {
    const items = game.items?.contents ?? [];
    if (items.length === 0) {
      ui.notifications.warn('NCM | No items found in the world.');
      return;
    }

    const itemCards = items.map(item => {
      const img = item.img && !item.img.includes('mystery-man') ? `<img src="${item.img}" alt="">` : `<i class="fas fa-cube"></i>`;
      const escapedName = item.name.replace(/"/g, '&quot;').replace(/</g, '&lt;');
      return `<div class="ncm-ip-item" data-item-id="${item.id}" data-item-name="${item.name.toLowerCase()}">
        <div class="ncm-ip-item-img">${img}</div>
        <div style="flex:1;min-width:0">
          <div class="ncm-ip-item-name">${escapedName}</div>
          <div class="ncm-ip-item-type">${item.type || 'Item'}</div>
        </div>
      </div>`;
    }).join('');

    const content = `
      <div class="ncm-ip-search-wrap">
        <i class="fas fa-magnifying-glass"></i>
        <input type="text" class="ncm-ip-search" placeholder="Search items..." autofocus />
      </div>
      <div class="ncm-ip-list">${itemCards || '<div class="ncm-ip-empty">No items found</div>'}</div>
    `;

    let selectedItem = null;
    const dialog = new Dialog({
      title: 'Select Key Item',
      content,
      buttons: { cancel: { label: 'Cancel', callback: () => {} } },
      default: 'cancel',
      render: (html) => {
        const jq = html instanceof jQuery ? html : $(html);
        const listEl = jq.find('.ncm-ip-list')[0] || jq[0]?.querySelector('.ncm-ip-list');
        const searchEl = jq.find('.ncm-ip-search')[0] || jq[0]?.querySelector('.ncm-ip-search');
        if (searchEl) {
          searchEl.addEventListener('input', () => {
            const query = searchEl.value.toLowerCase().trim();
            (listEl || jq[0]).querySelectorAll('.ncm-ip-item').forEach(card => {
              card.style.display = !query || (card.dataset.itemName || '').includes(query) ? '' : 'none';
            });
          });
        }
        if (listEl) {
          listEl.addEventListener('click', (e) => {
            const card = e.target.closest('.ncm-ip-item');
            if (!card) return;
            selectedItem = game.items.get(card.dataset.itemId);
            if (selectedItem) dialog.close();
          });
        }
      },
    }, {
      classes: ['dialog', 'ncm-item-picker-dialog'],
      width: 420, height: 480, resizable: true,
    });

    await new Promise(resolve => {
      dialog.close = new Proxy(dialog.close, {
        apply(t, thisArg, args) { const r = Reflect.apply(t, thisArg, args); resolve(); return r; }
      });
      dialog.render(true);
    });

    if (!selectedItem) return;

    const el = this.element;
    const setVal = (name, v) => { const inp = el?.querySelector(`[name="${name}"]`); if (inp) inp.value = v; };
    setVal('keyItemName', selectedItem.name);
    setVal('keyItemTag', selectedItem.system?.tag || '');
    setVal('keyItemImg', selectedItem.img || '');

    // Update filled/empty states
    const filled = el?.querySelector('[data-key-item-filled]');
    const empty = el?.querySelector('[data-key-item-empty]');
    if (filled) {
      filled.style.display = '';
      const imgSlot = filled.querySelector('[data-key-item-img-slot]');
      if (imgSlot) {
        const imgSrc = selectedItem.img;
        imgSlot.innerHTML = imgSrc && !imgSrc.includes('mystery-man')
          ? `<img src="${imgSrc}" alt="" style="width:100%;height:100%;object-fit:cover;border:none;">`
          : '<i class="fas fa-cube"></i>';
      }
      const nameSlot = filled.querySelector('[data-key-item-name-slot]');
      if (nameSlot) nameSlot.textContent = selectedItem.name;
    }
    if (empty) empty.style.display = 'none';
  }

  /**
   * Clear selected key item.
   */
  static _onClearKeyItem(event, target) {
    const el = this.element;
    const setVal = (name, v) => { const inp = el?.querySelector(`[name="${name}"]`); if (inp) inp.value = v; };
    setVal('keyItemName', '');
    setVal('keyItemTag', '');
    setVal('keyItemImg', '');

    const filled = el?.querySelector('[data-key-item-filled]');
    const empty = el?.querySelector('[data-key-item-empty]');
    if (filled) filled.style.display = 'none';
    if (empty) empty.style.display = '';
  }

  /**
   * Apply a preset template — fills form fields when creating a new network.
   */
  static _onApplyPreset(event, target) {
    const key = target.closest('[data-preset]')?.dataset.preset;
    if (!key) return;

    const PRESETS = {
      fixer_den: { type: 'hidden', description: 'Underground fixer network. Low profile.', signalStrength: 65, reliability: 70, messageDelay: 500, traced: false, anonymous: true, themeIcon: 'fa-handshake', themeColor: '#F65261' },
      corp_office: { type: 'corporate', description: 'Corporate internal network. Heavy ICE.', signalStrength: 90, reliability: 95, messageDelay: 200, traced: true, anonymous: false, themeIcon: 'fa-building', themeColor: '#f7c948' },
      gang_turf: { type: 'hidden', description: 'Gang-controlled local mesh. Unstable.', signalStrength: 45, reliability: 50, messageDelay: 800, traced: false, anonymous: true, themeIcon: 'fa-skull', themeColor: '#ff0033' },
      secure_facility: { type: 'government', description: 'Hardened facility network. Maximum security.', signalStrength: 95, reliability: 99, messageDelay: 100, traced: true, anonymous: false, themeIcon: 'fa-shield-halved', themeColor: '#19f3f7' },
      blank: { type: 'public', description: '', signalStrength: 75, reliability: 75, messageDelay: 300, traced: false, anonymous: false, themeIcon: 'fa-wifi', themeColor: '#19f3f7' },
    };

    const preset = PRESETS[key];
    if (!preset) return;

    const el = this.element;
    const set = (name, v) => { const inp = el?.querySelector(`[name="${name}"]`); if (inp) inp.value = v; };
    const chk = (name, v) => { const inp = el?.querySelector(`input[name="${name}"]`); if (inp) inp.checked = v; };
    const sel = (name, v) => { const s = el?.querySelector(`select[name="${name}"]`); if (s) s.value = v; };

    sel('type', preset.type);
    set('description', preset.description);
    set('signalStrength', preset.signalStrength);
    set('reliability', preset.reliability);
    set('messageDelay', preset.messageDelay);
    chk('traced', preset.traced);
    chk('anonymity', preset.anonymous);
    sel('themeIcon', preset.themeIcon);
    set('themeColor', preset.themeColor);
    set('themeColorText', preset.themeColor);
    const swatch = el?.querySelector('input[type="color"][name="themeColor"]');
    if (swatch) swatch.value = preset.themeColor;

    // Highlight active preset pill
    el?.querySelectorAll('.preset-pill').forEach(p => p.classList.remove('active'));
    target.closest('.preset-pill')?.classList.add('active');
  }

  static _onBrowseCustomImage(event, target) {
    const input = this.element?.querySelector('[data-custom-img-input]');
    new FilePicker({
      type: 'image',
      current: input?.value || '',
      callback: (path) => {
        if (input) input.value = path;
        const preview = this.element?.querySelector('[data-custom-img-preview]');
        if (preview) {
          preview.innerHTML = path
            ? `<img src="${path}" alt="" style="width:100%;height:100%;object-fit:contain;">`
            : '<i class="fas fa-image"></i>';
        }
      },
    }).render(true);
  }

  static _onSelectIceSource(event, target) {
    const mode = target.closest('[data-mode]')?.dataset.mode;
    if (!mode) return;
    // Toggle card selection
    this.element?.querySelectorAll('.ice-source-card').forEach(c => c.classList.remove('active'));
    (target.closest('.ice-source-card') || target).classList.add('active');
    // Toggle panels
    this.element?.querySelectorAll('.ice-panel').forEach(p => p.classList.remove('ice-panel--on'));
    this.element?.querySelector(`[data-ice-panel="${mode}"]`)?.classList.add('ice-panel--on');
    // Update hidden input
    const input = this.element?.querySelector('input[name="iceSource"]');
    if (input) input.value = mode;
  }

  static _onSelectIceActor(event, target) {
    const card = target.closest('.ice-actor-card') || target;
    const actorId = card.dataset.actorId;
    if (!actorId) return;
    this.element?.querySelectorAll('.ice-actor-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    const input = this.element?.querySelector('input[name="iceActorId"]');
    if (input) input.value = actorId;
  }

  static _onSelectIconMode(event, target) {
    const mode = target.closest('[data-mode]')?.dataset.mode;
    if (!mode) return;
    this.element?.querySelectorAll('.icon-mode-tab').forEach(t => t.classList.remove('active'));
    (target.closest('.icon-mode-tab') || target).classList.add('active');
    this.element?.querySelectorAll('.icon-mode-section').forEach(s => {
      s.style.display = s.dataset.iconMode === mode ? '' : 'none';
    });
    const input = this.element?.querySelector('input[name="iconMode"]');
    if (input) input.value = mode;
  }

  /**
   * Icon grid click — update hidden input + preview.
   */
  static _onSelectIcon(event, target) {
    const item = target.closest('[data-icon-value]');
    if (!item) return;
    const icon = item.dataset.iconValue;

    // Highlight
    this.element?.querySelectorAll('.netmgr-icon-grid__item').forEach(g => g.classList.remove('active'));
    item.classList.add('active');

    // Update hidden input
    const input = this.element?.querySelector('input[name="themeIcon"]');
    if (input) input.value = icon;

    // Update preview icon
    const previewI = this.element?.querySelector('[data-icon-preview-i]');
    if (previewI) previewI.className = `fas ${icon}`;
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

  // ── Sprint 6: Log Management ──

  static _onToggleAddLogForm() {
    this._showAddLogForm = !this._showAddLogForm;
    this.render(true);
  }

  static _onAddManualLogEntry(event, target) {
    event.preventDefault();
    const form = target.closest('.ncm-netmgr__add-log-form') || this.element?.querySelector('.ncm-netmgr__add-log-form');
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

    // Clear form
    const actorInput = form.querySelector('[name="logActor"]');
    const messageInput = form.querySelector('[name="logMessage"]');
    if (actorInput) actorInput.value = '';
    if (messageInput) messageInput.value = '';

    ui.notifications.info('NCM | Manual log entry added.');
    this.render(true);
  }

  static _onEditLogEntry(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const entryId = target.dataset.entryId || target.closest('[data-entry-id]')?.dataset.entryId;
    if (!entryId) return;

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

  static _onResetSecurity(event, target) {
    const actorId = target.dataset.actorId;
    const targetId = target.dataset.targetId;
    if (actorId && targetId) {
      this.securityService?.resetState(actorId, targetId);
      ui.notifications.info('NCM | Security state reset.');
      this.render();
    }
  }

  static _onToggleSidebarGroup(event, target) {
    const groupKey = target.dataset.groupKey || target.closest('[data-group-key]')?.dataset.groupKey;
    if (!groupKey) return;
    if (this._collapsedGroups.has(groupKey)) {
      this._collapsedGroups.delete(groupKey);
    } else {
      this._collapsedGroups.add(groupKey);
    }
    this.render(true);
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

  _formatLogDate(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}.${d.getFullYear()}`;
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
