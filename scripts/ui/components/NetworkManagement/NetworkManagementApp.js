/**
 * Network Management Application - REFACTORED
 * File: scripts/ui/components/NetworkManagement/NetworkManagementApp.js
 * Module: cyberpunkred-messenger
 * Description: Simplified GM interface - Scene Tab is single source of truth
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
  
  /* ========================================
     STATIC PROPERTIES
     ======================================== */
  
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'network-management',
      classes: ['ncm-network-management'],
      title: 'Network Management',
      template: 'modules/cyberpunkred-messenger/templates/network-management/network-management.hbs',
      width: 900,
      height: 700,
      resizable: true,
      tabs: [{ navSelector: '.tabs', contentSelector: '.content', initial: 'networks' }]
    });
  }
  
  /* ========================================
     DATA PREPARATION
     ======================================== */
  
  /**
   * Get data for template rendering
   * SIMPLIFIED: No sync status calculations
   */
  async getData() {
    const data = await super.getData();
    
    // Get all networks (properties only)
    const allNetworks = await this._getNetworks();
    
    // Get all scenes
    const scenes = await this._getScenes();
    
    // Get events and logs
    const events = await this._getEvents();
    const logs = await this._getLogs();
    
    // Current scene and its network configuration
    let currentScene = null;
    let sceneNetworks = [];
    let sceneSettings = {};
    
    if (this.activeTab === 'scenes') {
      if (!this.currentSceneId && game.scenes.active) {
        this.currentSceneId = game.scenes.active.id;
      }
      
      if (this.currentSceneId) {
        currentScene = game.scenes.get(this.currentSceneId);
        
        if (currentScene) {
          // SIMPLIFIED: No sync status, just get scene networks
          sceneNetworks = await this._getSceneNetworks(currentScene, allNetworks);
          
          // Scene settings
          sceneSettings = {
            autoSwitch: currentScene.getFlag(MODULE_ID, 'autoSwitch') || false,
            preferredNetwork: currentScene.getFlag(MODULE_ID, 'preferredNetwork') || null
          };
        }
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
        customNetworks: allNetworks.filter(n => n.type === 'custom' || n.type === 'CUSTOM').length,
        securedNetworks: allNetworks.filter(n => n.security?.requiresAuth).length,
        activeEvents: events.filter(e => e.active).length,
        recentLogs: logs.slice(0, 100).length
      }
    };
  }
  
  /* ========================================
     HELPER METHODS
     ======================================== */
  
  /**
   * Validate service availability
   * @private
   */
  _validateServices() {
    if (!game.nightcity?.networkStorage) {
      console.warn(`${MODULE_ID} | NetworkStorage service not available`);
      return false;
    }
    return true;
  }
  
  /**
   * Get networkStorage service
   * @private
   */
  get networkStorage() {
    return game.nightcity?.NetworkStorage || game.nightcity?.networkStorage;
  }
  
  /**
   * Get all networks from storage
   * @private
   */
  async _getNetworks() {
    if (!this._networks) {
      this._networks = await this.networkStorage.getAllNetworks();
    }
    return this._networks;
  }
  
  /**
   * Get all scenes
   * @private
   */
  async _getScenes() {
    if (!this._scenes) {
      this._scenes = game.scenes.contents.map(s => ({
        id: s.id,
        name: s.name,
        active: s.active
      }));
    }
    return this._scenes;
  }
  
  /**
   * Get network events
   * @private
   */
  async _getEvents() {
    if (!this._events) {
      this._events = await this._getNetworkEvents();
    }
    return this._events;
  }
  
  /**
   * Get network logs
   * @private
   */
  async _getLogs() {
    if (!this._logs) {
      this._logs = await this._getNetworkLogs();
    }
    return this._logs;
  }
  
  /**
   * Get network events (placeholder)
   * @private
   */
  async _getNetworkEvents() {
    // Placeholder for network events system
    return [];
  }
  
  /**
   * Get network logs
   * @private
   */
  async _getNetworkLogs() {
    return game.settings.get(MODULE_ID, 'networkLogs') || [];
  }
  
  /**
   * Get scene networks WITHOUT sync status
   * SIMPLIFIED: Just returns network + scene config, no sync calculations
   * @private
   */
  async _getSceneNetworks(scene, allNetworks) {
    const sceneNetworkConfig = scene.getFlag(MODULE_ID, 'networks') || {};
    
    return allNetworks.map(network => {
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
      
      return {
        ...network,
        sceneConfig: config,
        securityLevelClass,
        signalPercentage: config.signalStrength || 0,
        signalBars: Math.ceil((config.signalStrength || 0) / 20)
        // NO syncStatus property - removed!
      };
    });
  }
  
  /* ========================================
     EVENT LISTENERS
     ======================================== */
  
  /**
   * Activate event listeners
   * SIMPLIFIED: No sync action handlers
   */
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
    html.find('[data-action="toggle-auto-switch"]').change(this._onToggleAutoSwitch.bind(this));
    html.find('[data-action="set-preferred-network"]').change(this._onSetPreferredNetwork.bind(this));
    
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

  /* ========================================
     EVENT HANDLERS - All your existing handlers below
     Keep everything from your code
     ======================================== */
  
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

  async _onViewOverrides(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.dataset.networkId;
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    const config = scene.getFlag(MODULE_ID, 'networks')?.[networkId];
    
    if (!config?.override) {
      ui.notifications.info('No overrides configured for this network');
      return;
    }
    
    new Dialog({
      title: 'Scene Network Overrides',
      content: `<pre>${JSON.stringify(config.override, null, 2)}</pre>`,
      buttons: {
        close: { label: 'Close' }
      }
    }).render(true);
  }

  async _onClearOverrides(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.dataset.networkId;
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    const networks = scene.getFlag(MODULE_ID, 'networks') || {};
    
    if (networks[networkId]) {
      delete networks[networkId].override;
      await scene.setFlag(MODULE_ID, 'networks', networks);
      
      ui.notifications.info('Cleared network overrides');
      this._scenes = null;
      this.render(false);
    }
  }

  async _onTriggerEvent(event) {
    event.preventDefault();
    ui.notifications.info('Event system coming soon!');
  }

  async _onRefreshLogs(event) {
    event.preventDefault();
    this._logs = null;
    this.render(false);
  }

  async _onImportNetwork(event) {
    event.preventDefault();
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        const networks = Array.isArray(data) ? data : [data];
        
        for (const network of networks) {
          await this.networkStorage.createNetwork(network);
        }
        
        ui.notifications.info(`Imported ${networks.length} network(s)`);
        this._networks = null;
        this.render(false);
      } catch (error) {
        console.error('Import error:', error);
        ui.notifications.error('Failed to import networks');
      }
    };
    
    input.click();
  }

  /* ========================================
     EVENT HANDLERS - Networks Tab
     ======================================== */
  
  async _onTabChange(event) {
    event.preventDefault();
    const tab = event.currentTarget.dataset.tab;
    this.activeTab = tab;
    this.render(false);
  }

  _onFilterChange(event) {
    this.filterText = event.target.value;
    this.render(false);
  }

  _onSortChange(event) {
    const value = event.target.value;
    if (value.startsWith('-')) {
      this.sortBy = value.substring(1);
      this.sortDir = 'desc';
    } else {
      this.sortBy = value;
      this.sortDir = 'asc';
    }
    this.render(false);
  }

  async _onCreateNetwork(event) {
    event.preventDefault();
    
    const { NetworkEditorDialog } = await import('../../dialogs/NetworkEditorDialog.js');
    const result = await NetworkEditorDialog.show();
    
    if (result) {
      await this.networkStorage.createNetwork(result);
      ui.notifications.info(`Created network: ${result.name}`);
      this._networks = null;
      this.render(false);
    }
  }

  _onNetworkClick(event) {
    // Don't select if clicking on a button
    if (event.target.closest('button')) return;
    
    const card = event.currentTarget;
    const networkId = card.dataset.networkId;
    
    if (this.selectedNetworks.has(networkId)) {
      this.selectedNetworks.delete(networkId);
      card.classList.remove('selected');
    } else {
      this.selectedNetworks.add(networkId);
      card.classList.add('selected');
    }
  }

  _onNetworkSelect(event) {
    const checkbox = event.currentTarget;
    const networkId = checkbox.dataset.networkId;
    
    if (checkbox.checked) {
      this.selectedNetworks.add(networkId);
    } else {
      this.selectedNetworks.delete(networkId);
    }
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
    const result = await NetworkEditorDialog.show(network);
    
    if (result) {
      await this.networkStorage.updateNetwork(networkId, result);
      ui.notifications.info(`Updated network: ${result.name}`);
      this._networks = null;
      this.render(false);
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
    
    const duplicate = foundry.utils.deepClone(network);
    duplicate.id = `${network.id}_COPY_${Date.now()}`;
    duplicate.name = `${network.name} (Copy)`;
    
    await this.networkStorage.createNetwork(duplicate);
    ui.notifications.info(`Duplicated network: ${duplicate.name}`);
    this._networks = null;
    this.render(false);
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
    
    const confirmed = await Dialog.confirm({
      title: 'Delete Network',
      content: `<p>Are you sure you want to delete <strong>${network.name}</strong>?</p>`,
      yes: () => true,
      no: () => false
    });
    
    if (confirmed) {
      await this.networkStorage.deleteNetwork(networkId);
      ui.notifications.info(`Deleted network: ${network.name}`);
      this.selectedNetworks.delete(networkId);
      this._networks = null;
      this.render(false);
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
    
    const json = JSON.stringify(network, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${network.id}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    ui.notifications.info(`Exported network: ${network.name}`);
  }

  /* ========================================
     EVENT HANDLERS - Scenes Tab
     ======================================== */

  _onSceneSelect(event) {
    this.currentSceneId = event.target.value;
    this._scenes = null;
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
    
    // Set default signal strength if enabling
    if (available && !networks[networkId].signalStrength) {
      networks[networkId].signalStrength = 100;
    }
    
    await scene.setFlag(MODULE_ID, 'networks', networks);
    
    console.log(`${MODULE_ID} | Network ${networkId} ${available ? 'enabled' : 'disabled'} for scene ${scene.name}`);
    
    // Update UI without full re-render
    const card = checkbox.closest('.ncm-scene-network-card');
    if (card) {
      if (available) {
        card.classList.remove('ncm-scene-network-card--disabled');
        const body = card.querySelector('.ncm-scene-network-card__body');
        const disabled = card.querySelector('.ncm-scene-network-card__disabled-state');
        if (body) body.style.display = 'flex';
        if (disabled) disabled.style.display = 'none';
      } else {
        card.classList.add('ncm-scene-network-card--disabled');
        const body = card.querySelector('.ncm-scene-network-card__body');
        const disabled = card.querySelector('.ncm-scene-network-card__disabled-state');
        if (body) body.style.display = 'none';
        if (disabled) disabled.style.display = 'block';
      }
    }
  }

  async _onUpdateSignalStrength(event) {
    const slider = event.currentTarget;
    const networkId = slider.dataset.networkId;
    const signalStrength = parseInt(slider.value);
    
    // Update display
    const display = slider.parentElement.querySelector('.ncm-signal-display');
    if (display) display.textContent = `${signalStrength}%`;
    
    // Debounce updates
    clearTimeout(this._signalUpdateTimeout);
    this._signalUpdateTimeout = setTimeout(async () => {
      if (!this.currentSceneId) return;
      
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
    
    const scene = game.scenes.get(this.currentSceneId);
    const networks = scene.getFlag(MODULE_ID, 'networks') || {};
    
    const allNetworks = await this.networkStorage.getAllNetworks();
    
    for (const network of allNetworks) {
      if (!networks[network.id]) networks[network.id] = {};
      networks[network.id].available = true;
      if (!networks[network.id].signalStrength) {
        networks[network.id].signalStrength = 100;
      }
    }
    
    await scene.setFlag(MODULE_ID, 'networks', networks);
    
    ui.notifications.info(`Enabled all networks for ${scene.name}`);
    this._scenes = null;
    this.render(false);
  }

  async _onDisableAllNetworks(event) {
    event.preventDefault();
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    const networks = scene.getFlag(MODULE_ID, 'networks') || {};
    
    const allNetworks = await this.networkStorage.getAllNetworks();
    
    for (const network of allNetworks) {
      if (!networks[network.id]) networks[network.id] = {};
      networks[network.id].available = false;
    }
    
    await scene.setFlag(MODULE_ID, 'networks', networks);
    
    ui.notifications.info(`Disabled all networks for ${scene.name}`);
    this._scenes = null;
    this.render(false);
  }

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
    
    // Show dialog to select target scenes
    const content = `
      <form>
        <div class="form-group">
          <label>Copy network configuration to:</label>
          <div style="max-height: 300px; overflow-y: auto;">
            ${game.scenes.filter(s => s.id !== this.currentSceneId).map(s => `
              <label style="display: block; margin: 5px 0;">
                <input type="checkbox" name="scenes" value="${s.id}">
                ${s.name}
              </label>
            `).join('')}
          </div>
        </div>
      </form>
    `;
    
    const result = await Dialog.prompt({
      title: 'Copy Network Configuration',
      content: content,
      callback: html => {
        const selected = html.find('input[name="scenes"]:checked').map((i, el) => el.value).get();
        return selected;
      }
    });
    
    if (result && result.length > 0) {
      for (const sceneId of result) {
        const targetScene = game.scenes.get(sceneId);
        if (targetScene) {
          await targetScene.setFlag(MODULE_ID, 'networks', foundry.utils.deepClone(config));
        }
      }
      
      ui.notifications.info(`Copied configuration to ${result.length} scene(s)`);
    }
  }

  async _onApplyTemplate(event) {
    event.preventDefault();
    ui.notifications.info('Template system coming soon!');
  }

  async _onResetScene(event) {
    event.preventDefault();
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    if (!scene) return;
    
    const confirmed = await Dialog.confirm({
      title: 'Reset Scene Networks',
      content: '<p>This will clear all network configuration for this scene. Continue?</p>'
    });
    
    if (confirmed) {
      await scene.unsetFlag(MODULE_ID, 'networks');
      ui.notifications.info(`Reset network configuration for ${scene.name}`);
      this._scenes = null;
      this.render(false);
    }
  }

  async _onToggleAutoSwitch(event) {
    const enabled = event.currentTarget.checked;
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    if (!scene) return;
    
    const settings = scene.getFlag(MODULE_ID, 'settings') || {};
    settings.autoSwitch = enabled;
    
    await scene.setFlag(MODULE_ID, 'settings', settings);
    
    console.log(`${MODULE_ID} | Auto-switch ${enabled ? 'enabled' : 'disabled'} for ${scene.name}`);
  }

  async _onSetPreferredNetwork(event) {
    const networkId = event.currentTarget.value || null;
    
    if (!this.currentSceneId) return;
    
    const scene = game.scenes.get(this.currentSceneId);
    if (!scene) return;
    
    const settings = scene.getFlag(MODULE_ID, 'settings') || {};
    settings.preferredNetwork = networkId;
    
    await scene.setFlag(MODULE_ID, 'settings', settings);
    
    console.log(`${MODULE_ID} | Preferred network set to ${networkId || 'Auto'} for ${scene.name}`);
  }

  /* ========================================
     EVENT HANDLERS - Bulk Operations
     ======================================== */

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
    
    const confirmed = await Dialog.confirm({
      title: 'Delete Networks',
      content: `<p>Delete ${this.selectedNetworks.size} selected network(s)?</p>`
    });
    
    if (confirmed) {
      for (const networkId of this.selectedNetworks) {
        await this.networkStorage.deleteNetwork(networkId);
      }
      
      ui.notifications.info(`Deleted ${this.selectedNetworks.size} network(s)`);
      this.selectedNetworks.clear();
      this._networks = null;
      this.render(false);
    }
  }

  async _onBulkEnable(event) {
    event.preventDefault();
    ui.notifications.info('Bulk enable coming soon!');
  }

  async _onBulkDisable(event) {
    event.preventDefault();
    ui.notifications.info('Bulk disable coming soon!');
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
    
    const json = JSON.stringify(networks, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `networks_${Date.now()}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    ui.notifications.info(`Exported ${networks.length} network(s)`);
  }

  /* ========================================
     EVENT HANDLERS - Events & Logs
     ======================================== */

  async _onCreateEvent(event) {
    event.preventDefault();
    ui.notifications.info('Event creation coming soon!');
  }

  async _onEventClick(event) {
    // Handle event selection
  }

  async _onEditEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    ui.notifications.info('Event editing coming soon!');
  }

  async _onDeleteEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    ui.notifications.info('Event deletion coming soon!');
  }

  async _onToggleEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    ui.notifications.info('Event toggle coming soon!');
  }

  async _onClearLogs(event) {
    event.preventDefault();
    
    const confirmed = await Dialog.confirm({
      title: 'Clear Logs',
      content: '<p>Clear all network logs?</p>'
    });
    
    if (confirmed) {
      await game.settings.set(MODULE_ID, 'networkLogs', []);
      ui.notifications.info('Cleared all network logs');
      this.render(false);
    }
  }

  async _onExportLogs(event) {
    event.preventDefault();
    
    const logs = await this._getNetworkLogs();
    const json = JSON.stringify(logs, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `network_logs_${Date.now()}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    ui.notifications.info('Exported network logs');
  }

  _onLogFilter(event) {
    // Implement log filtering
  }
}

// CRITICAL: Export the class
export default NetworkManagementApp;