/**
 * Network Management Application - Compatible with Static NetworkStorage
 * File: scripts/ui/components/NetworkManagement/NetworkManagementApp.js
 * Module: cyberpunkred-messenger
 * 
 * FIXED: Works with static NetworkStorage class (not instance)
 */

import { MODULE_ID } from '../../../utils/constants.js';

export class NetworkManagementApp extends Application {
  constructor(options = {}) {
    super(options);
    
    this.activeTab = 'networks';
    this.selectedScene = game.scenes.current?.id || null;
    this.selectedNetworks = new Set();
    this.filterText = '';
    this.sortBy = 'name';
    this.sortDir = 'asc';
    this.currentSceneId = null;
    
    // Cache
    this._networks = null;
    this._scenes = null;
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
    
    // Import NetworkStorage statically
    const { NetworkStorage } = await import('../../../core/NetworkStorage.js');
    
    // Get networks using static method
    const allNetworks = await NetworkStorage.getAllNetworks();
    
    // Get current scene
    let currentScene = null;
    let sceneNetworks = [];
    
    if (this.currentSceneId) {
      const scene = game.scenes.get(this.currentSceneId);
      if (scene) {
        const sceneNetworkConfig = scene.getFlag(MODULE_ID, 'networks') || {};
        
        currentScene = {
          id: scene.id,
          name: scene.name,
          active: scene.active
        };
        
        sceneNetworks = allNetworks.map(network => {
          const config = sceneNetworkConfig[network.id] || {
            available: false,
            signalStrength: 100,
            override: null
          };
          
          return {
            ...network,
            sceneConfig: config
          };
        });
      }
    }
    
    // Filter networks for Networks tab
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
      scenes: game.scenes.map(s => ({
        id: s.id,
        name: s.name,
        active: s.active,
        selected: s.id === this.currentSceneId
      })),
      currentScene: currentScene,
      currentSceneId: this.currentSceneId,
      sceneNetworks: sceneNetworks,
      isGM: game.user.isGM
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
    
    // Scenes tab
    html.find('#scene-selector').change(this._onSceneSelect.bind(this));
    html.find('[data-action="toggle-network-availability"]').change(this._onToggleNetworkAvailability.bind(this));
    html.find('[data-action="update-signal-strength"]').on('input', this._onUpdateSignalStrength.bind(this));
    html.find('[data-action="enable-all"]').click(this._onEnableAllNetworks.bind(this));
    html.find('[data-action="disable-all"]').click(this._onDisableAllNetworks.bind(this));
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  async _onTabChange(event) {
    event.preventDefault();
    const tab = event.currentTarget.dataset.tab;
    this.activeTab = tab;
    
    if (tab === 'scenes' && !this.currentSceneId && game.scenes.active) {
      this.currentSceneId = game.scenes.active.id;
    }
    
    await this.render(false);
  }

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
    const { NetworkStorage } = await import('../../../core/NetworkStorage.js');
    
    new NetworkEditorDialog({
      mode: 'create',
      onSave: async (networkData) => {
        try {
          await NetworkStorage.createNetwork(networkData);
          ui.notifications.info(`Network "${networkData.name}" created`);
          this._networks = null;
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
    
    const { NetworkStorage } = await import('../../../core/NetworkStorage.js');
    const networkId = event.currentTarget.closest('.network-card').dataset.networkId;
    const network = await NetworkStorage.getNetwork(networkId);
    
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
          await NetworkStorage.updateNetwork(networkId, networkData);
          ui.notifications.info(`Network "${networkData.name}" updated`);
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
    
    const { NetworkStorage } = await import('../../../core/NetworkStorage.js');
    const networkId = event.currentTarget.closest('.network-card').dataset.networkId;
    const network = await NetworkStorage.getNetwork(networkId);
    
    if (!network) {
      ui.notifications.error('Network not found');
      return;
    }
    
    const duplicate = foundry.utils.duplicate(network);
    duplicate.id = `${network.id}_COPY_${Date.now()}`;
    duplicate.name = `${network.name} (Copy)`;
    
    const { NetworkEditorDialog } = await import('../../dialogs/NetworkEditorDialog.js');
    
    new NetworkEditorDialog({
      mode: 'create',
      network: duplicate,
      onSave: async (networkData) => {
        try {
          await NetworkStorage.createNetwork(networkData);
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
    
    const { NetworkStorage } = await import('../../../core/NetworkStorage.js');
    const networkId = event.currentTarget.closest('.network-card').dataset.networkId;
    const network = await NetworkStorage.getNetwork(networkId);
    
    if (!network) {
      ui.notifications.error('Network not found');
      return;
    }
    
    const confirm = await Dialog.confirm({
      title: 'Delete Network',
      content: `<p>Are you sure you want to delete <strong>${network.name}</strong>?</p>`,
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    try {
      await NetworkStorage.deleteNetwork(networkId);
      ui.notifications.info(`Network "${network.name}" deleted`);
      this._networks = null;
      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Error deleting network:`, error);
      ui.notifications.error(`Failed to delete network: ${error.message}`);
    }
  }

  _onSceneSelect(event) {
    event.preventDefault();
    this.currentSceneId = event.currentTarget.value;
    this.render(false);
  }

  async _onToggleNetworkAvailability(event) {
    event.preventDefault();
    
    const checkbox = event.currentTarget;
    const networkId = checkbox.dataset.networkId;
    const available = checkbox.checked;
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    const networks = scene.getFlag(MODULE_ID, 'networks') || {};
    
    if (!networks[networkId]) networks[networkId] = {};
    networks[networkId].available = available;
    
    if (available && !networks[networkId].signalStrength) {
      networks[networkId].signalStrength = 100;
    }
    
    await scene.setFlag(MODULE_ID, 'networks', networks);
    
    const card = checkbox.closest('.ncm-scene-network-card');
    if (card) {
      if (available) {
        card.classList.remove('ncm-scene-network-card--disabled');
      } else {
        card.classList.add('ncm-scene-network-card--disabled');
      }
    }
  }

  async _onUpdateSignalStrength(event) {
    event.preventDefault();
    
    const slider = event.currentTarget;
    const networkId = slider.dataset.networkId;
    const signalStrength = parseInt(slider.value);
    
    if (!this.currentSceneId) return;
    
    // Update display immediately
    const card = slider.closest('.ncm-scene-network-card');
    const valueDisplay = card?.querySelector('.ncm-scene-network-card__signal-value');
    if (valueDisplay) {
      valueDisplay.textContent = `${signalStrength}%`;
    }
    
    // Debounce save
    clearTimeout(this._signalUpdateTimeout);
    this._signalUpdateTimeout = setTimeout(async () => {
      const scene = game.scenes.get(this.currentSceneId);
      if (!scene) return;
      
      const networks = scene.getFlag(MODULE_ID, 'networks') || {};
      if (!networks[networkId]) networks[networkId] = {};
      
      networks[networkId].signalStrength = signalStrength;
      await scene.setFlag(MODULE_ID, 'networks', networks);
      
      console.log(`${MODULE_ID} | Updated signal strength for ${networkId} to ${signalStrength}%`);
    }, 500);
  }

  async _onEnableAllNetworks(event) {
    event.preventDefault();
    
    if (!this.currentSceneId) return;
    
    const { NetworkStorage } = await import('../../../core/NetworkStorage.js');
    const scene = game.scenes.get(this.currentSceneId);
    const networks = scene.getFlag(MODULE_ID, 'networks') || {};
    
    const allNetworks = await NetworkStorage.getAllNetworks();
    
    for (const network of allNetworks) {
      if (!networks[network.id]) networks[network.id] = {};
      networks[network.id].available = true;
      if (!networks[network.id].signalStrength) {
        networks[network.id].signalStrength = 100;
      }
    }
    
    await scene.setFlag(MODULE_ID, 'networks', networks);
    ui.notifications.info(`Enabled all networks for ${scene.name}`);
    this._networks = null;
    this.render(false);
  }

  async _onDisableAllNetworks(event) {
    event.preventDefault();
    
    if (!this.currentSceneId) return;
    
    const { NetworkStorage } = await import('../../../core/NetworkStorage.js');
    const scene = game.scenes.get(this.currentSceneId);
    const networks = scene.getFlag(MODULE_ID, 'networks') || {};
    
    const allNetworks = await NetworkStorage.getAllNetworks();
    
    for (const network of allNetworks) {
      if (!networks[network.id]) networks[network.id] = {};
      networks[network.id].available = false;
    }
    
    await scene.setFlag(MODULE_ID, 'networks', networks);
    ui.notifications.info(`Disabled all networks for ${scene.name}`);
    this._networks = null;
    this.render(false);
  }
}