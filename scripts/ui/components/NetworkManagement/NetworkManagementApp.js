/**
 * Network Management Application
 * File: scripts/ui/components/NetworkManagement/NetworkManagementApp.js
 * Module: cyberpunkred-messenger
 * Description: GM interface for managing networks, events, logs, and configuration
 */

import { MODULE_ID } from '../../../utils/constants.js';

export class NetworkManagementApp extends Application {
  constructor(options = {}) {
    super(options);
    
    this.activeTab = 'networks';
    this.selectedNetworks = new Set();
    this.filterText = '';
    this.sortBy = 'name';
    this.sortDir = 'asc';
    this.currentSceneId = null; 
    
    // Cache
    this._networks = null;
    this._scenes = null;
    this._events = null;
    this._logs = null;
    
    // Validate service availability
    this._validateServices();
  }
  
  /**
   * Validate that required services are available
   * @private
   */
  _validateServices() {
    if (!game.nightcity) {
      console.warn(`${MODULE_ID} | game.nightcity not initialized - some features may not work`);
      return false;
    }
    
    if (!game.nightcity.networkStorage) {
      console.warn(`${MODULE_ID} | NetworkStorage service not initialized - some features may not work`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Get the NetworkStorage service with error handling
   * @private
   */
  get networkStorage() {
    if (!game.nightcity?.networkStorage) {
      console.error(`${MODULE_ID} | NetworkStorage service not available`);
      ui.notifications.error('Network storage service not initialized. Please reload the world.');
      return null;
    }
    return game.nightcity.networkStorage;
  }
  
  /**
   * Get the NetworkEventService with error handling
   * @private
   */
  get networkEventService() {
    return game.nightcity?.networkEventService || null;
  }
  
  /**
   * Get the NetworkAccessLogService with error handling
   * @private
   */
  get networkAccessLogService() {
    return game.nightcity?.networkAccessLogService || null;
  }
  
  /**
   * Get the ChatIntegration with error handling
   * @private
   */
  get chatIntegration() {
    return game.nightcity?.chatIntegration || null;
  }
  
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'ncm-network-management',
      template: `modules/${MODULE_ID}/templates/network-management/network-management.hbs`,
      classes: ['ncm-app', 'ncm-network-management'],
      width: 1000,
      height: 700,
      title: '🌐 Network Management',
      resizable: true,
      minimizable: true,
      tabs: [{
        navSelector: '.tabs',
        contentSelector: '.tab-content',
        initial: 'networks'
      }]
    });
  }
  
  async getData() {
    const data = await super.getData();
    
    // Get all data needed for tabs
    const allNetworks = await this._getNetworks();
    const scenes = await this._getScenes();
    const events = await this._getEvents();
    const logs = await this._getLogs();

    // Get current scene if one is selected
    let currentScene = null;
    let sceneNetworks = [];
    let sceneSettings = {};
    
    if (this.currentSceneId) {
      const scene = game.scenes.get(this.currentSceneId);
      if (scene) {
        // Get scene network configuration
        const sceneNetworkConfig = scene.getFlag(MODULE_ID, 'networks') || {};
        sceneSettings = scene.getFlag(MODULE_ID, 'sceneSettings') || {
          autoSwitch: false,
          preferredNetwork: null
        };
        
        // Prepare scene data
        currentScene = {
          id: scene.id,
          name: scene.name,
          active: scene.active,
          width: scene.width,
          height: scene.height
        };
        
        // Prepare networks with scene-specific configuration
        sceneNetworks = allNetworks.map(network => {
          const config = sceneNetworkConfig[network.id] || {
            available: false,
            signalStrength: 0,
            override: null
          };
          
          // Calculate security level class for styling
          let securityLevelClass = 'ncm-security-none';
          if (network.security?.level) {
            securityLevelClass = `ncm-security-${network.security.level.toLowerCase()}`;
          }

          // Ensure theme data with fallbacks
          const theme = {
            icon: network.theme?.icon || this._getDefaultIcon(network.id),
            color: network.theme?.color || this._getDefaultColor(network.id)
          };
          
          return {
            ...network,
            theme,
            sceneConfig: config,
            securityLevelClass,
            signalPercentage: config.signalStrength || 0,
            signalBars: Math.ceil((config.signalStrength || 0) / 20)
          };
        });
      }
    }
    
      // Filter and sort networks for Networks tab
      let filteredNetworks = allNetworks;
      if (this.filterText) {
        const filter = this.filterText.toLowerCase();
        filteredNetworks = allNetworks.filter(n => 
          n.name.toLowerCase().includes(filter) ||
          n.id.toLowerCase().includes(filter) ||
          n.type.toLowerCase().includes(filter)
        );
      }
      
      // Sort networks
      filteredNetworks.sort((a, b) => {
        let aVal, bVal;
        switch(this.sortBy) {
          case 'type':
            aVal = a.type;
            bVal = b.type;
            break;
          case 'security':
            aVal = a.security?.level || 'NONE';
            bVal = b.security?.level || 'NONE';
            break;
          default:
            aVal = a.name;
            bVal = b.name;
        }
        
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
        currentScene: currentScene,
        currentSceneId: this.currentSceneId,
        sceneNetworks: sceneNetworks,
        sceneSettings: sceneSettings,
        events: events,
        logs: logs,
        stats: {
          totalNetworks: allNetworks.length,
          customNetworks: allNetworks.filter(n => n.type === 'CUSTOM').length,
          securedNetworks: allNetworks.filter(n => n.requiresAuth).length,
          activeEvents: events.filter(e => e.active).length,
          recentLogs: logs.slice(0, 100).length
        }
      };
    }
  
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
      html.find('[data-action="update-signal-strength"]').on('input', this._onUpdateSignalStrength.bind(this));
      html.find('.scene-config-btn').click(this._onConfigureScene.bind(this));
      html.find('.copy-to-scenes-btn').click(this._onCopyToScenes.bind(this));
      html.find('#scene-selector').change(this._onSceneSelect.bind(this));
      html.find('[data-action="configure-scene"]').click(this._onConfigureScene.bind(this));
      html.find('[data-action="copy-to-scenes"]').click(this._onCopyToScenes.bind(this));
      html.find('[data-action="apply-template"]').click(this._onApplyTemplate.bind(this));
      html.find('[data-action="reset-scene"]').click(this._onResetScene.bind(this));
      html.find('[data-action="enable-all"]').click(this._onEnableAllNetworks.bind(this));
      html.find('[data-action="disable-all"]').click(this._onDisableAllNetworks.bind(this));
      html.find('[data-action="toggle-network-availability"]').change(this._onToggleNetworkAvailability.bind(this));
      html.find('[data-action="configure-network-override"]').click(this._onConfigureNetworkOverride.bind(this));
      html.find('[data-action="view-overrides"]').click(this._onViewOverrides.bind(this));
      html.find('[data-action="clear-overrides"]').click(this._onClearOverrides.bind(this));
      html.find('[data-action="save-scene-settings"]').click(this._onSaveSceneSettings.bind(this));
      html.find('[data-action="reset-scene-settings"]').click(this._onResetSceneSettings.bind(this));
      
      // Events tab
      html.find('.create-event-btn').click(this._onCreateEvent.bind(this));
      html.find('.edit-event-btn').click(this._onEditEvent.bind(this));
      html.find('.delete-event-btn').click(this._onDeleteEvent.bind(this));
      html.find('.trigger-event-btn').click(this._onTriggerEvent.bind(this));
      
      // Logs tab
      html.find('.log-filter').on('input', this._onLogFilter.bind(this));
      html.find('.log-export-btn').click(this._onExportLogs.bind(this));
      html.find('.log-clear-btn').click(this._onClearLogs.bind(this));
      html.find('.log-refresh-btn').click(this._onRefreshLogs.bind(this));
      
      // Import
      html.find('.import-network-btn').click(this._onImportNetwork.bind(this));
    }
  
  /* -------------------------------------------- */
  /*  Event Handlers - Tabs                       */
  /* -------------------------------------------- */
  
  async _onTabChange(event) {
    event.preventDefault();
    
    const tab = event.currentTarget.dataset.tab;
    this.activeTab = tab;
    
    // Auto-select active scene when switching to scenes tab
    if (tab === 'scenes' && !this.currentSceneId && game.scenes.active) {
      this.currentSceneId = game.scenes.active.id;
    }
    
    this.render(false).then(() => {
      // After render, update the dropdown value if on scenes tab
      if (tab === 'scenes' && this.currentSceneId) {
        const dropdown = this.element.find('#scene-selector');
        if (dropdown.length) {
          dropdown.val(this.currentSceneId);
        }
      }
    });
  }
  
  /* -------------------------------------------- */
  /*  Event Handlers - Networks Tab               */
  /* -------------------------------------------- */
  
  _onFilterChange(event) {
    this.filterText = event.target.value;
    this.render(false);
  }
  
  _onSortChange(event) {
    const [sortBy, sortDir] = event.target.value.split('-');
    this.sortBy = sortBy;
    this.sortDir = sortDir;
    this.render(false);
  }
  
  async _onCreateNetwork(event) {
    event.preventDefault();
    
    const { NetworkEditorDialog } = await import('../../dialogs/NetworkEditorDialog.js');
    
    new NetworkEditorDialog({
      mode: 'create',
      onSave: async (networkData) => {
        try {
          await this.networkStorage.createNetwork(networkData);
          
          ui.notifications.info(`Network "${networkData.name}" created`);
          
          // Post to chat (optional)
          if (this.chatIntegration?.postNetworkEvent) {
            await this.chatIntegration.postNetworkEvent({
              type: 'network-created',
              network: networkData,
              user: game.user.name
            });
          }
          
          this._networks = null; // Clear cache
          this.render(false);
        } catch (error) {
          console.error(`${MODULE_ID} | Error creating network:`, error);
          ui.notifications.error(`Failed to create network: ${error.message}`);
        }
      }
    }).render(true);
  }
  
  _onNetworkClick(event) {
    if (event.target.closest('.network-actions')) return;
    
    const card = event.currentTarget;
    card.classList.toggle('expanded');
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
    
    const networkId = event.currentTarget.closest('.network-card').dataset.networkId;
    const network = await this.networkStorage.getNetwork(networkId);
    
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
          // ============================================
          // 1. Update network object
          // ============================================
          await this.networkStorage.updateNetwork(networkId, networkData);
          
          // ============================================
          // 2.  Sync scene flags to match
          // ============================================
          await this._syncSceneFlagsFromNetwork(networkId, networkData);
          
          ui.notifications.info(`Network "${networkData.name}" updated`);
          
          // Post to chat (optional)
          if (this.chatIntegration?.postNetworkEvent) {
            await this.chatIntegration.postNetworkEvent({
              type: 'network-updated',
              network: networkData,
              user: game.user.name
            });
          }
          
          // ============================================
          // 3. Emit hook for NetworkSelector
          // ============================================
          Hooks.callAll('cyberpunkred-messenger.networkAvailabilityChanged', {
            networkId,
            source: 'network-editor'
          });
          
          this._networks = null;
          this.render(false);
        } catch (error) {
          console.error(`${MODULE_ID} | Error updating network:`, error);
          ui.notifications.error(`Failed to update network: ${error.message}`);
        }
      }
    }).render(true);
  }

  /**
   * Sync scene flags to match network availability
   * When a network is edited in Network Editor, update all scene flags
   * @private
   */
  async _syncSceneFlagsFromNetwork(networkId, networkData) {
    console.log(`${MODULE_ID} | Syncing scene flags for ${networkId}`);
    
    const availability = networkData.availability;
    
    if (availability.global) {
      // Global network - ensure all scenes have it enabled
      for (const scene of game.scenes) {
        const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};
        if (!sceneNetworks[networkId]) sceneNetworks[networkId] = {};
        sceneNetworks[networkId].available = true;
        if (!sceneNetworks[networkId].signalStrength) {
          sceneNetworks[networkId].signalStrength = 100;
        }
        await scene.setFlag(MODULE_ID, 'networks', sceneNetworks);
      }
      console.log(`${MODULE_ID} | ✅ Synced global network to all scenes`);
    } else {
      // Scene-specific network
      const selectedScenes = availability.scenes || [];
      
      for (const scene of game.scenes) {
        const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};
        if (!sceneNetworks[networkId]) sceneNetworks[networkId] = {};
        
        // Set available based on whether scene is in array
        sceneNetworks[networkId].available = selectedScenes.includes(scene.id);
        
        if (sceneNetworks[networkId].available && !sceneNetworks[networkId].signalStrength) {
          sceneNetworks[networkId].signalStrength = 100;
        }
        
        await scene.setFlag(MODULE_ID, 'networks', sceneNetworks);
      }
      
      console.log(`${MODULE_ID} | ✅ Synced network to ${selectedScenes.length} scene(s)`);
    }
  }
  
  async _onDuplicateNetwork(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.closest('.network-card').dataset.networkId;
    const network = await this.networkStorage.getNetwork(networkId);
    
    if (!network) {
      ui.notifications.error('Network not found');
      return;
    }
    
    // Create duplicate with new ID
    const duplicate = foundry.utils.duplicate(network);
    duplicate.id = `${network.id}_COPY_${Date.now()}`;
    duplicate.name = `${network.name} (Copy)`;
    
    const { NetworkEditorDialog } = await import('../../dialogs/NetworkEditorDialog.js');
    
    new NetworkEditorDialog({
      mode: 'create',
      network: duplicate,
      onSave: async (networkData) => {
        try {
          await this.networkStorage.createNetwork(networkData);
          
          ui.notifications.info(`Network "${networkData.name}" duplicated`);
          
          this._networks = null;
          this.render(false);
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
    
    const networkId = event.currentTarget.closest('.network-card').dataset.networkId;
    const network = await this.networkStorage.getNetwork(networkId);
    
    if (!network) {
      ui.notifications.error('Network not found');
      return;
    }
    
    // Confirm deletion
    const confirm = await Dialog.confirm({
      title: 'Delete Network',
      content: `<p>Are you sure you want to delete <strong>${network.name}</strong>?</p>
                <p class="warning">This will also remove it from all scenes and may affect messages.</p>`,
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    try {
      await this.networkStorage.deleteNetwork(networkId);
      
      ui.notifications.info(`Network "${network.name}" deleted`);
      
      // Post to chat (optional)
      if (this.chatIntegration?.postNetworkEvent) {
        await this.chatIntegration.postNetworkEvent({
          type: 'network-deleted',
          network: network,
          user: game.user.name
        });
      }
      
      this._networks = null;
      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Error deleting network:`, error);
      ui.notifications.error(`Failed to delete network: ${error.message}`);
    }
  }
  
  async _onExportNetwork(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.closest('.network-card').dataset.networkId;
    const network = await this.networkStorage.getNetwork(networkId);
    
    if (!network) {
      ui.notifications.error('Network not found');
      return;
    }
    
    const exportData = {
      version: '1.0',
      module: MODULE_ID,
      network: network,
      exportedAt: new Date().toISOString(),
      exportedBy: game.user.name
    };
    
    const filename = `network-${network.id.toLowerCase()}-${Date.now()}.json`;
    const json = JSON.stringify(exportData, null, 2);
    
    saveDataToFile(json, 'application/json', filename);
    ui.notifications.info(`Network "${network.name}" exported`);
  }
  
  /* -------------------------------------------- */
  /*  Event Handlers - Bulk Operations            */
  /* -------------------------------------------- */
  
  _onSelectAll(event) {
    event.preventDefault();
    
    this._networks.forEach(n => this.selectedNetworks.add(n.id));
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
      title: 'Bulk Delete Networks',
      content: `<p>Are you sure you want to delete ${this.selectedNetworks.size} network(s)?</p>
                <p class="warning">This action cannot be undone.</p>`,
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    let deleted = 0;
    for (const networkId of this.selectedNetworks) {
      try {
        await this.networkStorage.deleteNetwork(networkId);
        deleted++;
      } catch (error) {
        console.error(`${MODULE_ID} | Error deleting network ${networkId}:`, error);
      }
    }
    
    ui.notifications.info(`Deleted ${deleted} network(s)`);
    this.selectedNetworks.clear();
    this._networks = null;
    this.render(false);
  }
  
  async _onBulkEnable(event) {
    event.preventDefault();
    
    if (this.selectedNetworks.size === 0) {
      ui.notifications.warn('No networks selected');
      return;
    }
    
    for (const networkId of this.selectedNetworks) {
      try {
        const network = await this.networkStorage.getNetwork(networkId);
        if (network) {
          await this.networkStorage.updateNetwork(networkId, {
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
  }
  
  async _onBulkDisable(event) {
    event.preventDefault();
    
    if (this.selectedNetworks.size === 0) {
      ui.notifications.warn('No networks selected');
      return;
    }
    
    for (const networkId of this.selectedNetworks) {
      try {
        const network = await this.networkStorage.getNetwork(networkId);
        if (network) {
          await this.networkStorage.updateNetwork(networkId, {
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
  }
  
  async _onBulkExport(event) {
    event.preventDefault();
    
    if (this.selectedNetworks.size === 0) {
      ui.notifications.warn('No networks selected');
      return;
    }
    
    const networks = [];
    for (const networkId of this.selectedNetworks) {
      const network = await this.networkStorage.getNetwork(networkId);
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
  /*  Event Handlers - Scenes Tab                 */
  /* -------------------------------------------- */
  
  async _onSceneNetworkToggle(event) {
    const toggle = event.currentTarget;
    const sceneId = toggle.dataset.sceneId;
    const networkId = toggle.dataset.networkId;
    const available = toggle.checked;
    
    const scene = game.scenes.get(sceneId);
    if (!scene) return;
    
    const networks = scene.getFlag(MODULE_ID, 'networks') || {};
    if (!networks[networkId]) networks[networkId] = {};
    
    networks[networkId].available = available;
    await scene.setFlag(MODULE_ID, 'networks', networks);
    
    ui.notifications.info(`Network ${available ? 'enabled' : 'disabled'} for scene`);
  }
  
  async _onSceneSignalChange(event) {
    const slider = event.currentTarget;
    const sceneId = slider.dataset.sceneId;
    const networkId = slider.dataset.networkId;
    const signalStrength = parseInt(slider.value);
    
    // Update display
    const display = slider.nextElementSibling;
    if (display) display.textContent = `${signalStrength}%`;
    
    // Debounce updates
    clearTimeout(this._signalUpdateTimeout);
    this._signalUpdateTimeout = setTimeout(async () => {
      const scene = game.scenes.get(sceneId);
      if (!scene) return;
      
      const networks = scene.getFlag(MODULE_ID, 'networks') || {};
      if (!networks[networkId]) networks[networkId] = {};
      
      networks[networkId].signalStrength = signalStrength;
      await scene.setFlag(MODULE_ID, 'networks', networks);
    }, 500);
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
        } catch (error) {
          console.error(`${MODULE_ID} | Error updating scene config:`, error);
          ui.notifications.error(`Failed to update scene configuration`);
        }
      }
    }).render(true);
  }
  
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
      content: `<p>Copy network configuration from <strong>${sourceScene.name}</strong> to all scenes?</p>`,
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
  }

  /**
   * Handle scene selection from dropdown
   * @param {Event} event - Change event
   * @private
   */
  _onSceneSelect(event) {
    event.preventDefault();
    
    const sceneId = event.currentTarget.value;
    
    // Update current scene ID
    this.currentSceneId = sceneId || null;
    
    // Re-render to show scene details
    this.render(false);
    
    console.log(`${MODULE_ID} | Scene selected:`, sceneId || 'None');
  }

  /**
   * Handle configure scene button click
   * @param {Event} event
   * @private
   */
  async _onConfigureScene(event) {
    event.preventDefault();
    
    if (!this.currentSceneId) {
      ui.notifications.warn('No scene selected');
      return;
    }
    
    const scene = game.scenes.get(this.currentSceneId);
    
    if (!scene) {
      ui.notifications.error('Scene not found');
      return;
    }
    
    const { SceneNetworkConfigDialog } = await import('../../dialogs/SceneNetworkConfigDialog.js');
    new SceneNetworkConfigDialog(scene).render(true);
  }

  /**
   * Handle copy to scenes button click
   * @param {Event} event
   * @private
   */
  async _onCopyToScenes(event) {
    event.preventDefault();
    
    if (!this.currentSceneId) {
      ui.notifications.warn('No scene selected');
      return;
    }
    
    const sourceScene = game.scenes.get(this.currentSceneId);
    
    if (!sourceScene) {
      ui.notifications.error('Scene not found');
      return;
    }
    
    const config = sourceScene.getFlag(MODULE_ID, 'networks');
    if (!config) {
      ui.notifications.warn('Source scene has no network configuration');
      return;
    }
    
    const confirm = await Dialog.confirm({
      title: 'Copy Network Configuration',
      content: `<p>Copy network configuration from <strong>${sourceScene.name}</strong> to all scenes?</p>`,
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    let copied = 0;
    for (const scene of game.scenes) {
      if (scene.id === this.currentSceneId) continue;
      
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
  }

  /**
   * Handle apply template button click
   * @param {Event} event
   * @private
   */
  async _onApplyTemplate(event) {
    event.preventDefault();
    
    if (!this.currentSceneId) {
      ui.notifications.warn('No scene selected');
      return;
    }
    
    // Template selection dialog
    const templates = {
      'combat-zone': {
        name: 'Combat Zone',
        description: 'High security, monitored networks',
        config: {
          'CITINET': { available: true, signalStrength: 50 },
          'CORPNET': { available: false, signalStrength: 0 },
          'DARKNET': { available: true, signalStrength: 80 },
          'DEAD_ZONE': { available: false, signalStrength: 0 }
        }
      },
      'corporate-hq': {
        name: 'Corporate HQ',
        description: 'Strong corporate network, weak public access',
        config: {
          'CITINET': { available: true, signalStrength: 60 },
          'CORPNET': { available: true, signalStrength: 100 },
          'DARKNET': { available: false, signalStrength: 0 },
          'DEAD_ZONE': { available: false, signalStrength: 0 }
        }
      },
      'public-area': {
        name: 'Public Area',
        description: 'Strong public network, no dark networks',
        config: {
          'CITINET': { available: true, signalStrength: 100 },
          'CORPNET': { available: false, signalStrength: 0 },
          'DARKNET': { available: false, signalStrength: 0 },
          'DEAD_ZONE': { available: false, signalStrength: 0 }
        }
      },
      'dead-zone': {
        name: 'Dead Zone',
        description: 'No network coverage',
        config: {
          'CITINET': { available: false, signalStrength: 0 },
          'CORPNET': { available: false, signalStrength: 0 },
          'DARKNET': { available: false, signalStrength: 0 },
          'DEAD_ZONE': { available: true, signalStrength: 100 }
        }
      }
    };
    
    const templateOptions = Object.entries(templates).map(([key, tpl]) => `
      <option value="${key}">${tpl.name} - ${tpl.description}</option>
    `).join('');
    
    const template = await Dialog.prompt({
      title: 'Apply Network Template',
      content: `
        <div class="form-group">
          <label>Select Template:</label>
          <select id="template-select">
            ${templateOptions}
          </select>
        </div>
      `,
      callback: (html) => html.find('#template-select').val(),
      rejectClose: false
    });
    
    if (!template) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    await scene.setFlag(MODULE_ID, 'networks', templates[template].config);
    
    ui.notifications.info(`Applied "${templates[template].name}" template to ${scene.name}`);
    this._scenes = null;
    this.render(false);
  }

  /**
   * Handle reset scene button click
   * @param {Event} event
   * @private
   */
  async _onResetScene(event) {
    event.preventDefault();
    
    if (!this.currentSceneId) {
      ui.notifications.warn('No scene selected');
      return;
    }
    
    const scene = game.scenes.get(this.currentSceneId);
    
    const confirm = await Dialog.confirm({
      title: 'Reset Scene Configuration',
      content: `<p>Reset all network configuration for <strong>${scene.name}</strong>?</p>`,
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    await scene.unsetFlag(MODULE_ID, 'networks');
    await scene.unsetFlag(MODULE_ID, 'sceneSettings');
    
    ui.notifications.info(`Reset network configuration for ${scene.name}`);
    this._scenes = null;
    this.render(false);
  }

  /**
   * Handle enable all networks button click
   * @param {Event} event
   * @private
   */
  async _onEnableAllNetworks(event) {
    event.preventDefault();
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};
    
    // Get all networks from storage
    const allNetworks = await this.networkStorage.getAllNetworks();
    
    for (const network of allNetworks) {
      // Update scene flag
      if (!sceneNetworks[network.id]) sceneNetworks[network.id] = {};
      sceneNetworks[network.id].available = true;
      if (!sceneNetworks[network.id].signalStrength) {
        sceneNetworks[network.id].signalStrength = 100;
      }
      
      // ✨ FIX: Update network availability array (if not global)
      if (!network.availability.global) {
        if (!network.availability.scenes) {
          network.availability.scenes = [];
        }
        if (!network.availability.scenes.includes(scene.id)) {
          network.availability.scenes.push(scene.id);
        }
      }
    }
    
    // Save everything
    await scene.setFlag(MODULE_ID, 'networks', sceneNetworks);
    await game.settings.set(MODULE_ID, 'customNetworks', allNetworks);
    
    ui.notifications.info(`Enabled all networks for ${scene.name}`);
    
    this._scenes = null;
    this._networks = null;
    this.render(false);
    
    // Emit hook
    Hooks.callAll('cyberpunkred-messenger.networkAvailabilityChanged', {
      sceneId: scene.id,
      bulk: true
    });
  }

  /**
   * Handle disable all networks button click
   * @param {Event} event
   * @private
   */
  async _onDisableAllNetworks(event) {
    event.preventDefault();
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};
    
    // Get all networks from storage
    const allNetworks = await this.networkStorage.getAllNetworks();
    
    for (const network of allNetworks) {
      // Update scene flag
      if (!sceneNetworks[network.id]) sceneNetworks[network.id] = {};
      sceneNetworks[network.id].available = false;
      
      // ✨ FIX: Update network availability array (if not global)
      if (!network.availability.global) {
        if (!network.availability.scenes) {
          network.availability.scenes = [];
        }
        const index = network.availability.scenes.indexOf(scene.id);
        if (index > -1) {
          network.availability.scenes.splice(index, 1);
        }
      }
    }
    
    // Save everything
    await scene.setFlag(MODULE_ID, 'networks', sceneNetworks);
    await game.settings.set(MODULE_ID, 'customNetworks', allNetworks);
    
    ui.notifications.info(`Disabled all networks for ${scene.name}`);
    
    this._scenes = null;
    this._networks = null;
    this.render(false);
    
    // Emit hook
    Hooks.callAll('cyberpunkred-messenger.networkAvailabilityChanged', {
      sceneId: scene.id,
      bulk: true
    });
  }

  /**
   * Handle toggle network availability for scene
   * @param {Event} event
   * @private
   */
  async _onToggleNetworkAvailability(event) {
    event.preventDefault();
    
    const checkbox = event.currentTarget;
    const networkId = checkbox.dataset.networkId;
    const available = checkbox.checked;
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    
    console.log(`${MODULE_ID} | Toggle ${networkId} to ${available ? 'ON' : 'OFF'} for scene ${scene.name}`);
    
    // ============================================
    // 1. Update SCENE FLAG (for UI and overrides)
    // ============================================
    const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};
    
    if (!sceneNetworks[networkId]) sceneNetworks[networkId] = {};
    sceneNetworks[networkId].available = available;
    
    // Set default signal strength if enabling
    if (available && !sceneNetworks[networkId].signalStrength) {
      sceneNetworks[networkId].signalStrength = 100;
    }
    
    await scene.setFlag(MODULE_ID, 'networks', sceneNetworks);
    console.log(`${MODULE_ID} | ✅ Scene flag updated`);
    
    // ============================================
    // 2. ✨ FIX: Update NETWORK AVAILABILITY ARRAY
    //    Directly modify the settings array
    // ============================================
    const allNetworks = await this.networkStorage.getAllNetworks();
    const networkIndex = allNetworks.findIndex(n => n.id === networkId);
    
    if (networkIndex !== -1) {
      const network = allNetworks[networkIndex];
      
      // Don't modify global networks (they're always available everywhere)
      if (!network.availability.global) {
        // Initialize scenes array if it doesn't exist
        if (!network.availability.scenes) {
          network.availability.scenes = [];
        }
        
        if (available) {
          // Add scene if not already in list
          if (!network.availability.scenes.includes(scene.id)) {
            network.availability.scenes.push(scene.id);
            console.log(`${MODULE_ID} | ✅ Added scene ${scene.name} (${scene.id}) to ${networkId} availability`);
          } else {
            console.log(`${MODULE_ID} | Scene already in availability array`);
          }
        } else {
          // Remove scene from list
          const index = network.availability.scenes.indexOf(scene.id);
          if (index > -1) {
            network.availability.scenes.splice(index, 1);
            console.log(`${MODULE_ID} | ✅ Removed scene ${scene.name} (${scene.id}) from ${networkId} availability`);
          }
        }
        
        // ✨ CRITICAL: Save the entire networks array back to settings
        await game.settings.set(MODULE_ID, 'customNetworks', allNetworks);
        console.log(`${MODULE_ID} | ✅ Settings saved. ${networkId}.availability.scenes =`, network.availability.scenes);
      } else {
        console.log(`${MODULE_ID} | ${networkId} is global, skipping scenes array update`);
      }
    } else {
      console.warn(`${MODULE_ID} | ⚠️ Network ${networkId} not found in storage`);
    }
    
    // ============================================
    // 3. REFRESH UI
    // ============================================
    this._scenes = null;
    this._networks = null;
    this.render(false);
    
    // ============================================
    // 4. EMIT HOOK for NetworkSelector to refresh
    // ============================================
    Hooks.callAll('cyberpunkred-messenger.networkAvailabilityChanged', {
      networkId,
      sceneId: scene.id,
      available
    });
    console.log(`${MODULE_ID} | ✅ Hook emitted`);
    
    // ============================================
    // 5. USER FEEDBACK
    // ============================================
    const statusText = available ? 'enabled' : 'disabled';
    ui.notifications.info(`${networkId} ${statusText} for ${scene.name}`);
    
    // ============================================
    // 6. VERIFY IT WORKED (diagnostic log)
    // ============================================
    setTimeout(async () => {
      const verify = await this.networkStorage.getNetwork(networkId);
      console.log(`${MODULE_ID} | VERIFICATION: ${networkId}.availability.scenes =`, verify.availability.scenes);
      console.log(`${MODULE_ID} | Scene ${scene.id} in array?`, verify.availability.scenes.includes(scene.id));
    }, 500);
  }

  /**
   * Handle configure network override button click
   * @param {Event} event
   * @private
   */
  async _onConfigureNetworkOverride(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.dataset.networkId;
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    const network = await this.networkStorage.getNetwork(networkId);
    
    if (!network) {
      ui.notifications.error('Network not found');
      return;
    }
    
    const currentConfig = scene.getFlag(MODULE_ID, 'networks')?.[networkId] || {};
    
    const { SceneNetworkConfigDialog } = await import('../../dialogs/SceneNetworkConfigDialog.js');
    
    const result = await SceneNetworkConfigDialog.show(scene, network, currentConfig);
    
    if (result) {
      const networks = scene.getFlag(MODULE_ID, 'networks') || {};
      networks[networkId] = result;
      await scene.setFlag(MODULE_ID, 'networks', networks);
      
      ui.notifications.info(`Updated ${network.name} configuration for ${scene.name}`);
      this._scenes = null;
      this.render(false);
    }
  }

  /**
   * Handle view overrides button click
   * @param {Event} event
   * @private
   */
  async _onViewOverrides(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.dataset.networkId;
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    const config = scene.getFlag(MODULE_ID, 'networks')?.[networkId];
    
    if (!config?.override) {
      ui.notifications.info('No overrides configured');
      return;
    }
    
    // Show in chat
    ChatMessage.create({
      content: `
        <div class="ncm-chat-card">
          <h3><i class="fas fa-cog"></i> Network Overrides</h3>
          <p><strong>Scene:</strong> ${scene.name}</p>
          <p><strong>Network:</strong> ${networkId}</p>
          <pre>${JSON.stringify(config.override, null, 2)}</pre>
        </div>
      `,
      whisper: [game.user.id]
    });
  }

  /**
   * Handle clear overrides button click
   * @param {Event} event
   * @private
   */
  async _onClearOverrides(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.dataset.networkId;
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    const networks = scene.getFlag(MODULE_ID, 'networks') || {};
    
    if (networks[networkId]?.override) {
      delete networks[networkId].override;
      await scene.setFlag(MODULE_ID, 'networks', networks);
      
      ui.notifications.info(`Cleared overrides for ${networkId}`);
      this._scenes = null;
      this.render(false);
    }
  }

  /**
   * Handle signal strength slider change
   * @param {Event} event
   * @private
   */
  async _onUpdateSignalStrength(event) {
    event.preventDefault();
    
    const slider = event.currentTarget;
    const networkId = slider.dataset.networkId;
    const signalStrength = parseInt(slider.value);
    
    if (!this.currentSceneId) return;
    
    // Update the visual display immediately
    const card = slider.closest('.ncm-scene-network-card');
    const valueDisplay = card?.querySelector('.ncm-scene-network-card__signal-value');
    if (valueDisplay) {
      valueDisplay.textContent = `${signalStrength}%`;
    }
    
    // Update signal bars
    const bars = card?.querySelectorAll('.ncm-signal-bar');
    if (bars) {
      bars.forEach((bar, index) => {
        const threshold = ((index + 1) / 5) * 100; // 5 bars
        if (signalStrength >= threshold) {
          bar.classList.add('ncm-signal-bar--active');
        } else {
          bar.classList.remove('ncm-signal-bar--active');
        }
      });
    }
    
    // Update status badge
    const statusBadge = card?.querySelector('.ncm-scene-network-card__signal-status');
    if (statusBadge) {
      let badgeHTML = '';
      if (signalStrength >= 80) {
        badgeHTML = '<span class="ncm-badge ncm-badge--success"><i class="fas fa-signal"></i> Excellent</span>';
      } else if (signalStrength >= 60) {
        badgeHTML = '<span class="ncm-badge ncm-badge--info"><i class="fas fa-signal"></i> Good</span>';
      } else if (signalStrength >= 40) {
        badgeHTML = '<span class="ncm-badge ncm-badge--warning"><i class="fas fa-signal"></i> Fair</span>';
      } else if (signalStrength >= 20) {
        badgeHTML = '<span class="ncm-badge ncm-badge--warning"><i class="fas fa-signal"></i> Weak</span>';
      } else {
        badgeHTML = '<span class="ncm-badge ncm-badge--danger"><i class="fas fa-exclamation-triangle"></i> Very Weak</span>';
      }
      statusBadge.innerHTML = badgeHTML;
    }
    
    // Debounce the actual save
    clearTimeout(this._signalUpdateTimeout);
    this._signalUpdateTimeout = setTimeout(async () => {
      const scene = game.scenes.get(this.currentSceneId);
      if (!scene) return;
      
      const networks = scene.getFlag(MODULE_ID, 'networks') || {};
      if (!networks[networkId]) networks[networkId] = {};
      
      networks[networkId].signalStrength = signalStrength;
      
      await scene.setFlag(MODULE_ID, 'networks', networks);
      
      console.log(`${MODULE_ID} | Updated signal strength for ${networkId} to ${signalStrength}%`);
    }, 500); // Wait 500ms after user stops dragging
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
          await this.networkEventService.createEvent(eventData);
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
  
  async _onEditEvent(event) {
    event.preventDefault();
    
    const eventId = event.currentTarget.closest('.event-item').dataset.eventId;
    const eventData = await this.networkEventService.getEvent(eventId);
    
    if (!eventData) {
      ui.notifications.error('Event not found');
      return;
    }
    
    const { NetworkEventDialog } = await import('../../dialogs/NetworkEventDialog.js');
    
    new NetworkEventDialog({
      mode: 'edit',
      event: eventData,
      onSave: async (updatedData) => {
        try {
          await this.networkEventService.updateEvent(eventId, updatedData);
          ui.notifications.info(`Event "${updatedData.name}" updated`);
          this._events = null;
          this.render(false);
        } catch (error) {
          console.error(`${MODULE_ID} | Error updating event:`, error);
          ui.notifications.error(`Failed to update event`);
        }
      }
    }).render(true);
  }
  
  async _onDeleteEvent(event) {
    event.preventDefault();
    
    const eventId = event.currentTarget.closest('.event-item').dataset.eventId;
    const eventData = await this.networkEventService.getEvent(eventId);
    
    if (!eventData) {
      ui.notifications.error('Event not found');
      return;
    }
    
    const confirm = await Dialog.confirm({
      title: 'Delete Event',
      content: `<p>Delete event <strong>${eventData.name}</strong>?</p>`,
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    try {
      await this.networkEventService.deleteEvent(eventId);
      ui.notifications.info(`Event deleted`);
      this._events = null;
      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Error deleting event:`, error);
      ui.notifications.error(`Failed to delete event`);
    }
  }
  
  async _onTriggerEvent(event) {
    event.preventDefault();
    
    const eventId = event.currentTarget.closest('.event-item').dataset.eventId;
    
    try {
      await this.networkEventService.triggerEvent(eventId);
      ui.notifications.info(`Event triggered`);
    } catch (error) {
      console.error(`${MODULE_ID} | Error triggering event:`, error);
      ui.notifications.error(`Failed to trigger event`);
    }
  }

  /**
   * Handle save scene settings button click
   * @param {Event} event
   * @private
   */
  async _onSaveSceneSettings(event) {
    event.preventDefault();
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    const html = $(event.currentTarget).closest('.ncm-app');
    
    const sceneSettings = {
      autoSwitch: html.find('#scene-auto-switch').is(':checked'),
      preferredNetwork: html.find('#scene-preferred-network').val() || null
    };
    
    await scene.setFlag(MODULE_ID, 'sceneSettings', sceneSettings);
    
    ui.notifications.info(`Scene settings saved for ${scene.name}`);
    
    // Clear cache and refresh
    this._scenes = null;
    this.render(false);
  }

  /**
   * Handle reset scene settings button click
   * @param {Event} event
   * @private
   */
  async _onResetSceneSettings(event) {
    event.preventDefault();
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    
    const confirmed = await Dialog.confirm({
      title: "Reset Scene Settings",
      content: `<p>Reset scene settings for <strong>${scene.name}</strong> to defaults?</p>`,
      yes: () => true,
      no: () => false
    });
    
    if (!confirmed) return;
    
    const defaultSettings = {
      autoSwitch: true,
      preferredNetwork: null
    };
    
    await scene.setFlag(MODULE_ID, 'sceneSettings', defaultSettings);
    
    ui.notifications.info(`Scene settings reset for ${scene.name}`);
    
    // Clear cache and refresh
    this._scenes = null;
    this.render(false);
  }
  
  /* -------------------------------------------- */
  /*  Event Handlers - Logs Tab                   */
  /* -------------------------------------------- */
  
  _onLogFilter(event) {
    // Filter logs (implement in template with data filtering)
    this.render(false);
  }
  
  async _onExportLogs(event) {
    event.preventDefault();
    
    const logs = await this._getLogs();
    const exportData = {
      version: '1.0',
      module: MODULE_ID,
      logs: logs,
      exportedAt: new Date().toISOString(),
      exportedBy: game.user.name
    };
    
    const filename = `network-logs-${Date.now()}.json`;
    const json = JSON.stringify(exportData, null, 2);
    
    saveDataToFile(json, 'application/json', filename);
    ui.notifications.info(`Logs exported`);
  }
  
  async _onClearLogs(event) {
    event.preventDefault();
    
    const confirm = await Dialog.confirm({
      title: 'Clear Logs',
      content: '<p>Are you sure you want to clear all network logs?</p><p class="warning">This action cannot be undone.</p>',
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    try {
      await this.networkAccessLogService.clearLogs();
      ui.notifications.info('Logs cleared');
      this._logs = null;
      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Error clearing logs:`, error);
      ui.notifications.error('Failed to clear logs');
    }
  }
  
  async _onRefreshLogs(event) {
    event.preventDefault();
    
    this._logs = null;
    this.render(false);
  }
  
  /* -------------------------------------------- */
  /*  Import Handler                              */
  /* -------------------------------------------- */
  
  async _onImportNetwork(event) {
    event.preventDefault();
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const importData = JSON.parse(ev.target.result);
          
          // Validate import
          if (!importData.version || !importData.module || importData.module !== MODULE_ID) {
            throw new Error('Invalid import file');
          }
          
          // Import single network or multiple
          const networks = importData.networks || [importData.network];
          let imported = 0;
          
          for (const network of networks) {
            try {
              // Check if network exists
              const existing = await this.networkStorage.getNetwork(network.id);
              if (existing) {
                // Confirm overwrite
                const overwrite = await Dialog.confirm({
                  title: 'Network Exists',
                  content: `<p>Network <strong>${network.name}</strong> already exists. Overwrite?</p>`,
                  yes: () => true,
                  no: () => false
                });
                
                if (overwrite) {
                  await this.networkStorage.updateNetwork(network.id, network);
                  imported++;
                }
              } else {
                await this.networkStorage.createNetwork(network);
                imported++;
              }
            } catch (error) {
              console.error(`${MODULE_ID} | Error importing network:`, error);
            }
          }
          
          ui.notifications.info(`Imported ${imported} network(s)`);
          this._networks = null;
          this.render(false);
          
        } catch (error) {
          console.error(`${MODULE_ID} | Error parsing import file:`, error);
          ui.notifications.error('Failed to import: Invalid file format');
        }
      };
      
      reader.readAsText(file);
    };
    
    input.click();
  }
  
  /* -------------------------------------------- */
  /*  Data Fetchers (with caching)                */
  /* -------------------------------------------- */
  
    async _getNetworks() {
      if (!this._networks) {
        // Use lowercase networkStorage consistently
        const storage = this.networkStorage;
        if (!storage) {
          console.error(`${MODULE_ID} | NetworkStorage not available`);
          return [];
        }
        
        try {
          this._networks = await storage.getAllNetworks();
          
          // Ensure each network has required properties
          this._networks = this._networks.map(network => {
            if (!network.theme) {
              network.theme = {
                color: this._getDefaultColor(network.id),
                icon: this._getDefaultIcon(network.id)
              };
            }
            
            if (!network.security) {
              network.security = {
                level: 'MEDIUM',
                breachDC: 15,
                iceDamage: '3d6'
              };
            }
            
            return network;
          });
        } catch (error) {
          console.error(`${MODULE_ID} | Error fetching networks:`, error);
          ui.notifications.error('Failed to load networks');
          this._networks = [];
        }
      }
      return this._networks;
    }

    _getDefaultColor(networkId) {
      const colors = {
        'CITINET': '#19f3f7',
        'CORPNET': '#F65261',
        'DARKNET': '#9400D3',
        'DEAD_ZONE': '#666666'
      };
      return colors[networkId] || '#19f3f7';
    }

    _getDefaultIcon(networkId) {
      const icons = {
        'CITINET': 'fas fa-wifi',
        'CORPNET': 'fas fa-building',
        'DARKNET': 'fas fa-user-secret',
        'DEAD_ZONE': 'fas fa-ban'
      };
      return icons[networkId] || 'fas fa-network-wired';
    }
    
    async _getScenes() {
      if (!this._scenes) {
        this._scenes = game.scenes.map(scene => {
          const networks = scene.getFlag(MODULE_ID, 'networks') || {};
          return {
            id: scene.id,
            name: scene.name,
            networks: networks
          };
        });
      }
      return this._scenes;
    }
    
    async _getEvents() {
      if (!this._events) {
        const service = this.networkEventService;
        this._events = service ? (await service.getEvents()) : [];
      }
      return this._events;
    }
    
    async _getLogs() {
      if (!this._logs) {
        const service = this.networkAccessLogService;
        this._logs = service ? (await service.getLogs()) : [];
      }
      return this._logs;
    }
  }