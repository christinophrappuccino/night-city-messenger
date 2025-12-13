/**
 * Network Management Application
 * File: scripts/ui/components/NetworkManagement/NetworkManagementApp.js
 * Module: cyberpunkred-messenger
 * Description: GM interface for managing networks and scene configurations
 * 
 * FIXED: Added _syncNetworkUI() method that gets called after any scene flag changes
 * This ensures NetworkSelector and MessageViewer stay in sync with the configuration.
 */

import { MODULE_ID } from '../../../utils/constants.js';

export class NetworkManagementApp extends Application {
  
  constructor(options = {}) {
    super(options);
    
    this.activeTab = options.activeTab || 'networks';
    this.filterText = '';
    this.sortBy = 'name';
    this.sortDir = 'asc';
    this.selectedNetworks = new Set();
    
    // Cache
    this._networks = null;
    this._scenes = null;
    this._events = null;
    this._logs = null;
    
    // Debounce timer
    this._signalUpdateTimeout = null;
  }
  
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'ncm-network-management',
      template: `modules/${MODULE_ID}/templates/network-management/network-management.hbs`,
      classes: ['ncm-app', 'ncm-network-management'],
      width: 900,
      height: 700,
      title: 'Network Management',
      tabs: [{ navSelector: '.tabs', contentSelector: '.tab-content', initial: 'networks' }],
      resizable: true,
      minimizable: true
    });
  }
  
  /* -------------------------------------------- */
  /*  Data Preparation                            */
  /* -------------------------------------------- */
  
  async getData() {
    const data = await super.getData();
    
    // Get all data
    const networks = await this._getNetworks();
    const scenes = await this._getScenes();
    const events = await this._getEvents();
    const logs = await this._getLogs();
    
    // Build scene-network lookup for template
    const sceneNetworks = {};
    for (const scene of scenes) {
      for (const [networkId, config] of Object.entries(scene.networks || {})) {
        sceneNetworks[`${scene.id}.${networkId}`] = {
          networkId,
          available: config.available || false,
          signalStrength: config.signalStrength ?? 80
        };
      }
    }
    
    // Filter networks
    let filteredNetworks = [...networks];
    if (this.filterText) {
      const filter = this.filterText.toLowerCase();
      filteredNetworks = filteredNetworks.filter(n => 
        n.name.toLowerCase().includes(filter) ||
        n.id.toLowerCase().includes(filter)
      );
    }
    
    // Sort networks
    filteredNetworks.sort((a, b) => {
      let aVal = a[this.sortBy] || '';
      let bVal = b[this.sortBy] || '';
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      const comparison = aVal < bVal ? -1 : (aVal > bVal ? 1 : 0);
      return this.sortDir === 'asc' ? comparison : -comparison;
    });
    
    return {
      ...data,
      activeTab: this.activeTab,
      networks: filteredNetworks,
      selectedNetworks: Array.from(this.selectedNetworks),
      filterText: this.filterText,
      sortBy: this.sortBy,
      sortDir: this.sortDir,
      scenes: scenes,
      sceneNetworks: sceneNetworks,
      events: events,
      logs: logs,
      stats: {
        totalNetworks: networks.length,
        customNetworks: networks.filter(n => n.type === 'CUSTOM').length,
        securedNetworks: networks.filter(n => n.requiresAuth).length,
        activeEvents: events.filter(e => e.active).length,
        recentLogs: logs.slice(0, 100).length
      }
    };
  }
  
  /* -------------------------------------------- */
  /*  Event Listeners                             */
  /* -------------------------------------------- */
  
  activateListeners(html) {
    super.activateListeners(html);
    
    // Tab navigation
    html.find('.tabs .item').click(this._onTabChange.bind(this));
    
    // Networks tab
    html.find('.network-filter').on('input', this._onFilterChange.bind(this));
    html.find('.network-sort').change(this._onSortChange.bind(this));
    html.find('.create-network-btn').click(this._onCreateNetwork.bind(this));
    html.find('.network-card').click(this._onNetworkClick.bind(this));
    html.find('.network-checkbox').change(this._onNetworkSelect.bind(this));
    html.find('.edit-network-btn').click(this._onEditNetwork.bind(this));
    html.find('.duplicate-network-btn').click(this._onDuplicateNetwork.bind(this));
    html.find('.delete-network-btn').click(this._onDeleteNetwork.bind(this));
    html.find('.export-network-btn').click(this._onExportNetwork.bind(this));
    
    // Bulk operations
    html.find('.select-all-networks').click(this._onSelectAll.bind(this));
    html.find('.deselect-all-networks').click(this._onDeselectAll.bind(this));
    html.find('.bulk-delete-btn').click(this._onBulkDelete.bind(this));
    html.find('.bulk-enable-btn').click(this._onBulkEnable.bind(this));
    html.find('.bulk-disable-btn').click(this._onBulkDisable.bind(this));
    html.find('.bulk-export-btn').click(this._onBulkExport.bind(this));
    
    // Scenes tab
    html.find('.scene-network-toggle').change(this._onSceneNetworkToggle.bind(this));
    html.find('.scene-signal-slider').on('input', this._onSceneSignalInput.bind(this));
    html.find('.scene-signal-slider').on('change', this._onSceneSignalChange.bind(this));
    html.find('.scene-config-btn').click(this._onConfigureScene.bind(this));
    html.find('.copy-to-scenes-btn, .copy-scene-config').click(this._onCopyToScenes.bind(this));
    html.find('.enable-all-networks-scene').click(this._onEnableAllNetworksScene.bind(this));
    html.find('.reset-scene-config').click(this._onResetSceneConfig.bind(this));
    
    // Bulk scene operations
    html.find('.bulk-enable-all-btn').click(this._onBulkEnableAllScenes.bind(this));
    html.find('.bulk-disable-all-btn').click(this._onBulkDisableAllScenes.bind(this));
    html.find('.reset-signals-btn').click(this._onResetAllSignals.bind(this));
    
    // Events tab
    html.find('.create-event-btn').click(this._onCreateEvent.bind(this));
    html.find('.event-card').click(this._onEventClick.bind(this));
    html.find('.edit-event-btn').click(this._onEditEvent.bind(this));
    html.find('.delete-event-btn').click(this._onDeleteEvent.bind(this));
    html.find('.trigger-event-btn').click(this._onTriggerEvent.bind(this));
    
    // Logs tab
    html.find('.refresh-logs-btn').click(this._onRefreshLogs.bind(this));
    html.find('.clear-logs-btn').click(this._onClearLogs.bind(this));
    html.find('.export-logs-btn').click(this._onExportLogs.bind(this));
    
    // Import/Export
    html.find('.import-networks-btn').click(this._onImportNetworks.bind(this));
    html.find('.export-all-btn').click(this._onExportAll.bind(this));
  }
  
  /* -------------------------------------------- */
  /*  CRITICAL: Network UI Sync Method            */
  /* -------------------------------------------- */
  
  /**
   * Sync all network UI components after a configuration change
   * This is the KEY fix - call this after any scene flag changes
   * @param {Scene} [scene] - The scene that was modified (optional)
   * @private
   */
  async _syncNetworkUI(scene = null) {
    console.log(`${MODULE_ID} | Syncing network UI...`);
    
    // Only sync if this affects the active scene
    const affectsActiveScene = !scene || scene.active || scene.id === canvas.scene?.id;
    
    if (!affectsActiveScene) {
      console.log(`${MODULE_ID} | Scene ${scene?.name} is not active, skipping UI sync`);
      return;
    }
    
    // 1. Clear NetworkSelectorApp cache and re-render
    const selectorApp = game.nightcity?.networkSelectorApp;
    if (selectorApp) {
      selectorApp.cachedNetworks = null;
      selectorApp.cacheTimestamp = 0;
      if (selectorApp.rendered) {
        await selectorApp.render(false);
      }
      console.log(`${MODULE_ID} | ✓ NetworkSelectorApp refreshed`);
    }
    
    // 2. Tell NetworkManager to rescan
    const networkManager = game.nightcity?.networkManager;
    if (networkManager?.scanNetworks) {
      await networkManager.scanNetworks();
      console.log(`${MODULE_ID} | ✓ NetworkManager rescanned`);
    }
    
    // 3. Refresh any open MessageViewerApp
    for (const app of Object.values(ui.windows)) {
      if (app.constructor.name === 'MessageViewerApp' && app.rendered) {
        await app.render(false);
        console.log(`${MODULE_ID} | ✓ MessageViewerApp refreshed`);
      }
    }
    
    // 4. Emit event for any other listeners
    Hooks.call('ncm.networkConfigChanged', { scene: scene?.id || canvas.scene?.id });
  }
  
  /* -------------------------------------------- */
  /*  Event Handlers - Tab Navigation             */
  /* -------------------------------------------- */
  
  _onTabChange(event) {
    event.preventDefault();
    const tab = event.currentTarget.dataset.tab;
    this.activeTab = tab;
  }
  
  /* -------------------------------------------- */
  /*  Event Handlers - Networks Tab               */
  /* -------------------------------------------- */
  
  _onFilterChange(event) {
    this.filterText = event.target.value;
    this._networks = null;
    this.render(false);
  }
  
  _onSortChange(event) {
    const [sortBy, sortDir] = event.target.value.split('-');
    this.sortBy = sortBy;
    this.sortDir = sortDir || 'asc';
    this._networks = null;
    this.render(false);
  }
  
  async _onCreateNetwork(event) {
    event.preventDefault();
    
    const { NetworkEditorDialog } = await import('../../dialogs/NetworkEditorDialog.js');
    
    new NetworkEditorDialog({
      mode: 'create',
      onSave: async (networkData) => {
        try {
          await game.nightcity.NetworkStorage.createNetwork(networkData);
          ui.notifications.info(`Network "${networkData.name}" created`);
          this._networks = null;
          this.render(false);
          await this._syncNetworkUI();
        } catch (error) {
          console.error(`${MODULE_ID} | Error creating network:`, error);
          ui.notifications.error(`Failed to create network: ${error.message}`);
        }
      }
    }).render(true);
  }
  
  _onNetworkClick(event) {
    // Ignore if clicking on action buttons
    if ($(event.target).closest('button, input').length) return;
    
    const networkId = event.currentTarget.dataset.networkId;
    if (this.selectedNetworks.has(networkId)) {
      this.selectedNetworks.delete(networkId);
    } else {
      this.selectedNetworks.add(networkId);
    }
    this.render(false);
  }
  
  _onNetworkSelect(event) {
    const checkbox = event.currentTarget;
    const networkId = checkbox.dataset.networkId;
    
    if (checkbox.checked) {
      this.selectedNetworks.add(networkId);
    } else {
      this.selectedNetworks.delete(networkId);
    }
    this.render(false);
  }
  
  async _onEditNetwork(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.dataset.networkId;
    const network = await game.nightcity.NetworkStorage.getNetwork(networkId);
    
    if (!network) {
      ui.notifications.error('Network not found');
      return;
    }
    
    const { NetworkEditorDialog } = await import('../../dialogs/NetworkEditorDialog.js');
    
    new NetworkEditorDialog({
      mode: 'edit',
      network: network,
      onSave: async (networkData) => {
        try {
          await game.nightcity.NetworkStorage.updateNetwork(networkId, networkData);
          ui.notifications.info(`Network "${networkData.name}" updated`);
          this._networks = null;
          this.render(false);
          await this._syncNetworkUI();
        } catch (error) {
          console.error(`${MODULE_ID} | Error updating network:`, error);
          ui.notifications.error(`Failed to update network: ${error.message}`);
        }
      }
    }).render(true);
  }
  
  async _onDuplicateNetwork(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.dataset.networkId;
    const network = await game.nightcity.NetworkStorage.getNetwork(networkId);
    
    if (!network) {
      ui.notifications.error('Network not found');
      return;
    }
    
    const { NetworkEditorDialog } = await import('../../dialogs/NetworkEditorDialog.js');
    
    // Create a copy with new ID
    const duplicate = foundry.utils.deepClone(network);
    duplicate.id = `${network.id}_COPY`;
    duplicate.name = `${network.name} (Copy)`;
    
    new NetworkEditorDialog({
      mode: 'create',
      network: duplicate,
      onSave: async (networkData) => {
        try {
          await game.nightcity.NetworkStorage.createNetwork(networkData);
          ui.notifications.info(`Network "${networkData.name}" created`);
          this._networks = null;
          this.render(false);
          await this._syncNetworkUI();
        } catch (error) {
          console.error(`${MODULE_ID} | Error duplicating network:`, error);
          ui.notifications.error(`Failed to duplicate network: ${error.message}`);
        }
      }
    }).render(true);
  }
  
  async _onDeleteNetwork(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.dataset.networkId;
    const network = await game.nightcity.NetworkStorage.getNetwork(networkId);
    
    if (!network) return;
    
    const confirm = await Dialog.confirm({
      title: 'Delete Network',
      content: `<p>Are you sure you want to delete <strong>${network.name}</strong>?</p>
                <p class="warning">This will also remove it from all scene configurations.</p>`,
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    try {
      await game.nightcity.NetworkStorage.deleteNetwork(networkId);
      ui.notifications.info(`Network "${network.name}" deleted`);
      this._networks = null;
      this._scenes = null;
      this.render(false);
      await this._syncNetworkUI();
    } catch (error) {
      console.error(`${MODULE_ID} | Error deleting network:`, error);
      ui.notifications.error(`Failed to delete network: ${error.message}`);
    }
  }
  
  async _onExportNetwork(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.dataset.networkId;
    const network = await game.nightcity.NetworkStorage.getNetwork(networkId);
    
    if (!network) return;
    
    const exportData = {
      version: '1.0',
      module: MODULE_ID,
      networks: [network],
      exportedAt: new Date().toISOString(),
      exportedBy: game.user.name
    };
    
    const filename = `network-${network.id}-${Date.now()}.json`;
    const json = JSON.stringify(exportData, null, 2);
    
    saveDataToFile(json, 'application/json', filename);
  }
  
  /* -------------------------------------------- */
  /*  Event Handlers - Bulk Operations            */
  /* -------------------------------------------- */
  
  _onSelectAll(event) {
    event.preventDefault();
    this._networks?.forEach(n => this.selectedNetworks.add(n.id));
    this.render(false);
  }
  
  _onDeselectAll(event) {
    event.preventDefault();
    this.selectedNetworks.clear();
    this.render(false);
  }
  
  async _onBulkDelete(event) {
    event.preventDefault();
    
    if (this.selectedNetworks.size === 0) {
      ui.notifications.warn('No networks selected');
      return;
    }
    
    const confirm = await Dialog.confirm({
      title: 'Delete Networks',
      content: `<p>Delete ${this.selectedNetworks.size} selected network(s)?</p>`,
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    for (const networkId of this.selectedNetworks) {
      try {
        await game.nightcity.NetworkStorage.deleteNetwork(networkId);
      } catch (error) {
        console.error(`${MODULE_ID} | Error deleting network ${networkId}:`, error);
      }
    }
    
    ui.notifications.info(`Deleted ${this.selectedNetworks.size} network(s)`);
    this.selectedNetworks.clear();
    this._networks = null;
    this._scenes = null;
    this.render(false);
    await this._syncNetworkUI();
  }
  
  async _onBulkEnable(event) {
    event.preventDefault();
    
    if (this.selectedNetworks.size === 0) {
      ui.notifications.warn('No networks selected');
      return;
    }
    
    for (const networkId of this.selectedNetworks) {
      try {
        const network = await game.nightcity.NetworkStorage.getNetwork(networkId);
        if (network) {
          await game.nightcity.NetworkStorage.updateNetwork(networkId, {
            ...network,
            enabled: true
          });
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Error enabling network ${networkId}:`, error);
      }
    }
    
    ui.notifications.info(`Enabled ${this.selectedNetworks.size} network(s)`);
    this._networks = null;
    this.render(false);
    await this._syncNetworkUI();
  }
  
  async _onBulkDisable(event) {
    event.preventDefault();
    
    if (this.selectedNetworks.size === 0) {
      ui.notifications.warn('No networks selected');
      return;
    }
    
    for (const networkId of this.selectedNetworks) {
      try {
        const network = await game.nightcity.NetworkStorage.getNetwork(networkId);
        if (network) {
          await game.nightcity.NetworkStorage.updateNetwork(networkId, {
            ...network,
            enabled: false
          });
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Error disabling network ${networkId}:`, error);
      }
    }
    
    ui.notifications.info(`Disabled ${this.selectedNetworks.size} network(s)`);
    this._networks = null;
    this.render(false);
    await this._syncNetworkUI();
  }
  
  async _onBulkExport(event) {
    event.preventDefault();
    
    if (this.selectedNetworks.size === 0) {
      ui.notifications.warn('No networks selected');
      return;
    }
    
    const networks = [];
    for (const networkId of this.selectedNetworks) {
      const network = await game.nightcity.NetworkStorage.getNetwork(networkId);
      if (network) networks.push(network);
    }
    
    const exportData = {
      version: '1.0',
      module: MODULE_ID,
      networks: networks,
      exportedAt: new Date().toISOString(),
      exportedBy: game.user.name
    };
    
    const filename = `networks-bulk-${Date.now()}.json`;
    const json = JSON.stringify(exportData, null, 2);
    
    saveDataToFile(json, 'application/json', filename);
    ui.notifications.info(`Exported ${networks.length} network(s)`);
  }
  
  /* -------------------------------------------- */
  /*  Event Handlers - Scenes Tab (FIXED)         */
  /* -------------------------------------------- */
  
  /**
   * Handle network toggle in a scene
   * FIXED: Now calls _syncNetworkUI() after saving
   */
  async _onSceneNetworkToggle(event) {
    const toggle = event.currentTarget;
    const sceneId = toggle.dataset.sceneId;
    const networkId = toggle.dataset.networkId;
    const available = toggle.checked;
    
    const scene = game.scenes.get(sceneId);
    if (!scene) return;
    
    // Get current config
    const networks = scene.getFlag(MODULE_ID, 'networks') || {};
    if (!networks[networkId]) networks[networkId] = {};
    
    // Update availability
    networks[networkId].available = available;
    
    // If enabling and no signal strength set, use default
    if (available && !networks[networkId].signalStrength) {
      networks[networkId].signalStrength = 80;
    }
    
    // Save to scene flags
    await scene.setFlag(MODULE_ID, 'networks', networks);
    
    console.log(`${MODULE_ID} | Set ${networkId} available=${available} in scene ${scene.name}`);
    ui.notifications.info(`Network ${available ? 'enabled' : 'disabled'} for scene`);
    
    // Clear cache and re-render this dialog
    this._scenes = null;
    this.render(false);
    
    // CRITICAL FIX: Sync other network UI components
    await this._syncNetworkUI(scene);
  }
  
  /**
   * Handle signal slider input (real-time visual feedback)
   */
  _onSceneSignalInput(event) {
    const slider = event.currentTarget;
    const value = slider.value;
    
    // Update the display next to the slider
    const display = slider.nextElementSibling;
    if (display) {
      display.textContent = `${value}%`;
    }
    
    // Update signal bars if present
    const container = $(slider).closest('.signal-strength-container, .signal-control');
    const bars = container.find('.signal-bars .bar');
    bars.each((i, bar) => {
      const threshold = (i + 1) * 25;
      $(bar).toggleClass('active', parseInt(value) >= threshold);
    });
  }
  
  /**
   * Handle signal slider change (save on release)
   * FIXED: Now calls _syncNetworkUI() after saving
   */
  async _onSceneSignalChange(event) {
    const slider = event.currentTarget;
    const sceneId = slider.dataset.sceneId;
    const networkId = slider.dataset.networkId;
    const signalStrength = parseInt(slider.value);
    
    // Debounce to avoid rapid updates
    clearTimeout(this._signalUpdateTimeout);
    this._signalUpdateTimeout = setTimeout(async () => {
      const scene = game.scenes.get(sceneId);
      if (!scene) return;
      
      const networks = scene.getFlag(MODULE_ID, 'networks') || {};
      if (!networks[networkId]) networks[networkId] = {};
      
      networks[networkId].signalStrength = signalStrength;
      await scene.setFlag(MODULE_ID, 'networks', networks);
      
      console.log(`${MODULE_ID} | Set ${networkId} signal=${signalStrength}% in scene ${scene.name}`);
      
      // Clear cache
      this._scenes = null;
      
      // CRITICAL FIX: Sync if this is the active scene
      if (scene.active) {
        await this._syncNetworkUI(scene);
      }
    }, 300);
  }
  
  async _onConfigureScene(event) {
    event.preventDefault();
    
    const sceneId = event.currentTarget.dataset.sceneId;
    const scene = game.scenes.get(sceneId);
    
    if (!scene) {
      ui.notifications.error('Scene not found');
      return;
    }
    
    const { SceneNetworkConfigDialog } = await import('../../dialogs/SceneNetworkConfigDialog.js');
    
    new SceneNetworkConfigDialog({
      scene: scene,
      onSave: async (config) => {
        try {
          await scene.setFlag(MODULE_ID, 'networks', config);
          ui.notifications.info(`Scene network configuration updated`);
          this._scenes = null;
          this.render(false);
          
          // CRITICAL FIX: Sync UI
          await this._syncNetworkUI(scene);
        } catch (error) {
          console.error(`${MODULE_ID} | Error updating scene config:`, error);
          ui.notifications.error(`Failed to update scene configuration`);
        }
      }
    }).render(true);
  }
  
  /**
   * Copy network config from one scene to others
   * FIXED: Now calls _syncNetworkUI() after saving
   */
  async _onCopyToScenes(event) {
    event.preventDefault();
    
    const sourceSceneId = event.currentTarget.dataset.sceneId;
    const sourceScene = game.scenes.get(sourceSceneId);
    
    if (!sourceScene) return;
    
    const config = sourceScene.getFlag(MODULE_ID, 'networks');
    if (!config) {
      ui.notifications.warn('Source scene has no network configuration');
      return;
    }
    
    const confirm = await Dialog.confirm({
      title: 'Copy Network Configuration',
      content: `<p>Copy network configuration from <strong>${sourceScene.name}</strong> to all other scenes?</p>`,
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    let copied = 0;
    for (const scene of game.scenes) {
      if (scene.id === sourceSceneId) continue;
      
      try {
        await scene.setFlag(MODULE_ID, 'networks', config);
        copied++;
      } catch (error) {
        console.error(`${MODULE_ID} | Error copying config to scene:`, error);
      }
    }
    
    ui.notifications.info(`Network configuration copied to ${copied} scene(s)`);
    this._scenes = null;
    this.render(false);
    
    // CRITICAL FIX: Sync UI (active scene may have changed)
    await this._syncNetworkUI();
  }
  
  /**
   * Enable all networks in a specific scene
   * FIXED: Now calls _syncNetworkUI() after saving
   */
  async _onEnableAllNetworksScene(event) {
    event.preventDefault();
    
    const sceneId = event.currentTarget.dataset.sceneId;
    const scene = game.scenes.get(sceneId);
    if (!scene) return;
    
    const allNetworks = await this._getNetworks();
    const config = scene.getFlag(MODULE_ID, 'networks') || {};
    
    for (const network of allNetworks) {
      if (!config[network.id]) config[network.id] = {};
      config[network.id].available = true;
      config[network.id].signalStrength = config[network.id].signalStrength ?? 80;
    }
    
    await scene.setFlag(MODULE_ID, 'networks', config);
    
    ui.notifications.info(`Enabled all networks in ${scene.name}`);
    this._scenes = null;
    this.render(false);
    
    // CRITICAL FIX: Sync UI
    await this._syncNetworkUI(scene);
  }
  
  /**
   * Reset a scene's network configuration
   */
  async _onResetSceneConfig(event) {
    event.preventDefault();
    
    const sceneId = event.currentTarget.dataset.sceneId;
    const scene = game.scenes.get(sceneId);
    if (!scene) return;
    
    const confirm = await Dialog.confirm({
      title: 'Reset Scene Configuration',
      content: `<p>Reset network configuration for <strong>${scene.name}</strong>?</p>
                <p>This will disable all networks except CITINET.</p>`,
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    // Reset to default (only CITINET enabled)
    const config = {
      'CITINET': { available: true, signalStrength: 80 }
    };
    
    await scene.setFlag(MODULE_ID, 'networks', config);
    
    ui.notifications.info(`Reset network configuration for ${scene.name}`);
    this._scenes = null;
    this.render(false);
    
    await this._syncNetworkUI(scene);
  }
  
  /**
   * Enable all networks in ALL scenes
   */
  async _onBulkEnableAllScenes(event) {
    event.preventDefault();
    
    const confirm = await Dialog.confirm({
      title: 'Enable All Networks',
      content: '<p>Enable all networks in ALL scenes?</p>',
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    const allNetworks = await this._getNetworks();
    
    for (const scene of game.scenes) {
      const config = scene.getFlag(MODULE_ID, 'networks') || {};
      
      for (const network of allNetworks) {
        if (!config[network.id]) config[network.id] = {};
        config[network.id].available = true;
        config[network.id].signalStrength = config[network.id].signalStrength ?? 80;
      }
      
      await scene.setFlag(MODULE_ID, 'networks', config);
    }
    
    ui.notifications.info('Enabled all networks in all scenes');
    this._scenes = null;
    this.render(false);
    
    await this._syncNetworkUI();
  }
  
  /**
   * Disable all networks in ALL scenes
   */
  async _onBulkDisableAllScenes(event) {
    event.preventDefault();
    
    const confirm = await Dialog.confirm({
      title: 'Disable All Networks',
      content: '<p>Disable all networks in ALL scenes?</p><p class="warning">This will block all network communication!</p>',
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    for (const scene of game.scenes) {
      const config = scene.getFlag(MODULE_ID, 'networks') || {};
      
      for (const networkId of Object.keys(config)) {
        config[networkId].available = false;
      }
      
      await scene.setFlag(MODULE_ID, 'networks', config);
    }
    
    ui.notifications.info('Disabled all networks in all scenes');
    this._scenes = null;
    this.render(false);
    
    await this._syncNetworkUI();
  }
  
  /**
   * Reset all signal strengths to defaults
   */
  async _onResetAllSignals(event) {
    event.preventDefault();
    
    const confirm = await Dialog.confirm({
      title: 'Reset Signal Strengths',
      content: '<p>Reset all signal strengths to 80%?</p>',
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    for (const scene of game.scenes) {
      const config = scene.getFlag(MODULE_ID, 'networks') || {};
      
      for (const networkId of Object.keys(config)) {
        config[networkId].signalStrength = 80;
      }
      
      await scene.setFlag(MODULE_ID, 'networks', config);
    }
    
    ui.notifications.info('Reset all signal strengths');
    this._scenes = null;
    this.render(false);
    
    await this._syncNetworkUI();
  }
  
  /* -------------------------------------------- */
  /*  Event Handlers - Events Tab                 */
  /* -------------------------------------------- */
  
  async _onCreateEvent(event) {
    event.preventDefault();
    
    const { NetworkEventDialog } = await import('../../dialogs/NetworkEventDialog.js');
    
    new NetworkEventDialog({
      mode: 'create',
      onSave: async (eventData) => {
        try {
          await game.nightcity.NetworkEventService.createEvent(eventData);
          ui.notifications.info(`Event "${eventData.name}" created`);
          this._events = null;
          this.render(false);
        } catch (error) {
          console.error(`${MODULE_ID} | Error creating event:`, error);
          ui.notifications.error(`Failed to create event`);
        }
      }
    }).render(true);
  }
  
  _onEventClick(event) {
    // Future: Show event details
  }
  
  async _onEditEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    // Future implementation
  }
  
  async _onDeleteEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    // Future implementation
  }
  
  async _onTriggerEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    // Future implementation
  }
  
  /* -------------------------------------------- */
  /*  Event Handlers - Logs Tab                   */
  /* -------------------------------------------- */
  
  async _onRefreshLogs(event) {
    event.preventDefault();
    this._logs = null;
    this.render(false);
  }
  
  async _onClearLogs(event) {
    event.preventDefault();
    
    const confirm = await Dialog.confirm({
      title: 'Clear Logs',
      content: '<p>Clear all network access logs?</p>',
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    await game.nightcity.NetworkAccessLogService?.clearLogs();
    this._logs = null;
    this.render(false);
  }
  
  async _onExportLogs(event) {
    event.preventDefault();
    
    const logs = await this._getLogs();
    const exportData = {
      version: '1.0',
      module: MODULE_ID,
      logs: logs,
      exportedAt: new Date().toISOString()
    };
    
    const filename = `network-logs-${Date.now()}.json`;
    const json = JSON.stringify(exportData, null, 2);
    
    saveDataToFile(json, 'application/json', filename);
  }
  
  /* -------------------------------------------- */
  /*  Event Handlers - Import/Export              */
  /* -------------------------------------------- */
  
  async _onImportNetworks(event) {
    event.preventDefault();
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target.result);
          
          if (!data.networks || !Array.isArray(data.networks)) {
            throw new Error('Invalid import file format');
          }
          
          let imported = 0;
          for (const network of data.networks) {
            try {
              const existing = await game.nightcity.NetworkStorage.getNetwork(network.id);
              
              if (existing) {
                const overwrite = await Dialog.confirm({
                  title: 'Network Exists',
                  content: `<p>Network <strong>${network.name}</strong> already exists. Overwrite?</p>`,
                  yes: () => true,
                  no: () => false
                });
                
                if (overwrite) {
                  await game.nightcity.NetworkStorage.updateNetwork(network.id, network);
                  imported++;
                }
              } else {
                await game.nightcity.NetworkStorage.createNetwork(network);
                imported++;
              }
            } catch (error) {
              console.error(`${MODULE_ID} | Error importing network:`, error);
            }
          }
          
          ui.notifications.info(`Imported ${imported} network(s)`);
          this._networks = null;
          this.render(false);
          await this._syncNetworkUI();
          
        } catch (error) {
          console.error(`${MODULE_ID} | Error parsing import file:`, error);
          ui.notifications.error('Failed to import: Invalid file format');
        }
      };
      
      reader.readAsText(file);
    };
    
    input.click();
  }
  
  async _onExportAll(event) {
    event.preventDefault();
    
    const networks = await this._getNetworks();
    const scenes = await this._getScenes();
    
    const exportData = {
      version: '1.0',
      module: MODULE_ID,
      networks: networks,
      sceneConfigs: scenes.reduce((acc, scene) => {
        acc[scene.id] = {
          name: scene.name,
          networks: scene.networks
        };
        return acc;
      }, {}),
      exportedAt: new Date().toISOString(),
      exportedBy: game.user.name
    };
    
    const filename = `network-config-full-${Date.now()}.json`;
    const json = JSON.stringify(exportData, null, 2);
    
    saveDataToFile(json, 'application/json', filename);
    ui.notifications.info('Exported full network configuration');
  }
  
  /* -------------------------------------------- */
  /*  Data Fetchers (with caching)                */
  /* -------------------------------------------- */
  
  async _getNetworks() {
    if (!this._networks) {
      // Get ALL networks from storage, not just available ones
      this._networks = await game.nightcity.NetworkStorage?.getAllNetworks() 
        || await game.settings.get(MODULE_ID, 'customNetworks') 
        || [];
    }
    return this._networks;
  }
  
  async _getScenes() {
    if (!this._scenes) {
      this._scenes = game.scenes.map(scene => {
        const networks = scene.getFlag(MODULE_ID, 'networks') || {};
        return {
          id: scene.id,
          name: scene.name,
          active: scene.active,
          networks: networks,
          enabled: true
        };
      });
    }
    return this._scenes;
  }
  
  async _getEvents() {
    if (!this._events) {
      this._events = await game.nightcity.NetworkEventService?.getEvents() || [];
    }
    return this._events;
  }
  
  async _getLogs() {
    if (!this._logs) {
      this._logs = await game.nightcity.NetworkAccessLogService?.getLogs() || [];
    }
    return this._logs;
  }
}