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
    this.sortBy = 'name'; // name, type, security
    this.sortDir = 'asc';
    
    // Cache
    this._networks = null;
    this._scenes = null;
    this._events = null;
    this._logs = null;
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
    const networks = await this._getNetworks();
    const scenes = await this._getScenes();
    const events = await this._getEvents();
    const logs = await this._getLogs();
    
    // Filter and sort networks
    let filteredNetworks = networks;
    if (this.filterText) {
      const filter = this.filterText.toLowerCase();
      filteredNetworks = networks.filter(n => 
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
        default: // name
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
    html.find('.scene-signal-slider').on('input', this._onSceneSignalChange.bind(this));
    html.find('.scene-config-btn').click(this._onConfigureScene.bind(this));
    html.find('.copy-to-scenes-btn').click(this._onCopyToScenes.bind(this));
    
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
    await this.render(false);
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
          await game.nightcity.NetworkStorage.createNetwork(networkData);
          
          ui.notifications.info(`Network "${networkData.name}" created`);
          
          // Post to chat (optional)
          if (game.nightcity.chatIntegration?.postNetworkEvent) {
            await game.nightcity.chatIntegration.postNetworkEvent({
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
          
          await game.nightcity.chatIntegration.postNetworkEvent({
            type: 'network-updated',
            network: networkData,
            user: game.user.name
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
  
  async _onDuplicateNetwork(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.closest('.network-card').dataset.networkId;
    const network = await game.nightcity.NetworkStorage.getNetwork(networkId);
    
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
          await game.nightcity.NetworkStorage.createNetwork(networkData);
          
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
    const network = await game.nightcity.NetworkStorage.getNetwork(networkId);
    
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
      await game.nightcity.NetworkStorage.deleteNetwork(networkId);
      
      ui.notifications.info(`Network "${network.name}" deleted`);
      
      await game.nightcity.chatIntegration.postNetworkEvent({
        type: 'network-deleted',
        network: network,
        user: game.user.name
      });
      
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
    const network = await game.nightcity.NetworkStorage.getNetwork(networkId);
    
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
        await game.nightcity.NetworkStorage.deleteNetwork(networkId);
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
  
  async _onEditEvent(event) {
    event.preventDefault();
    
    const eventId = event.currentTarget.closest('.event-item').dataset.eventId;
    const eventData = await game.nightcity.NetworkEventService.getEvent(eventId);
    
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
          await game.nightcity.NetworkEventService.updateEvent(eventId, updatedData);
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
    const eventData = await game.nightcity.NetworkEventService.getEvent(eventId);
    
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
      await game.nightcity.NetworkEventService.deleteEvent(eventId);
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
      await game.nightcity.NetworkEventService.triggerEvent(eventId);
      ui.notifications.info(`Event triggered`);
    } catch (error) {
      console.error(`${MODULE_ID} | Error triggering event:`, error);
      ui.notifications.error(`Failed to trigger event`);
    }
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
      await game.nightcity.NetworkAccessLogService.clearLogs();
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
              const existing = await game.nightcity.NetworkStorage.getNetwork(network.id);
              if (existing) {
                // Confirm overwrite
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
      this._networks = await game.nightcity.networkManager.getAvailableNetworks();
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
          networks: networks
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