/**
 * Network Management Application - Streamlined UI
 * File: scripts/ui/components/NetworkManagement/NetworkManagementApp.js
 * Module: cyberpunkred-messenger
 * 
 * SIMPLIFIED ARCHITECTURE:
 * - Network Tab: Define network properties (name, type, security, theme, defaultHidden)
 * - Scene Tab: Configure where networks are available (AUTHORITATIVE)
 * - No more dual configuration - clear separation of concerns
 */

import { MODULE_ID } from '../../../constants.js';

export class NetworkManagementApp extends Application {
  constructor(options = {}) {
    super(options);
    
    this.activeTab = 'networks';
    this.selectedScene = game.scenes.current?.id || null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'network-management',
      classes: ['cyberpunkred-messenger', 'network-management'],
      template: 'modules/cyberpunkred-messenger/templates/network-management/network-management.hbs',
      width: 800,
      height: 600,
      resizable: true,
      title: 'Network Management',
      tabs: [
        {
          navSelector: '.tabs',
          contentSelector: '.tab-content',
          initial: 'networks'
        }
      ]
    });
  }

  async getData() {
    const data = await super.getData();
    const storage = game.nightcity.messenger.networkStorage;
    
    // Get all networks
    const networks = storage.getAllNetworks();
    
    // Get selected scene
    const scene = game.scenes.get(this.selectedScene) || game.scenes.current;
    const sceneNetworks = scene?.getFlag(MODULE_ID, 'networks') || {};
    
    return {
      ...data,
      activeTab: this.activeTab,
      networks: networks.map(network => ({
        ...network,
        // Add configuration status for this scene
        sceneConfig: sceneNetworks[network.id] || { available: false, signalStrength: 100 }
      })),
      scenes: game.scenes.map(s => ({
        id: s.id,
        name: s.name,
        active: s.active,
        selected: s.id === this.selectedScene
      })),
      selectedScene: scene,
      selectedSceneId: this.selectedScene,
      isGM: game.user.isGM
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Tab switching
    html.find('.tabs a').click(this._onTabChange.bind(this));
    
    // Network Tab Actions
    html.find('[data-action="create-network"]').click(this._onCreateNetwork.bind(this));
    html.find('[data-action="edit-network"]').click(this._onEditNetwork.bind(this));
    html.find('[data-action="delete-network"]').click(this._onDeleteNetwork.bind(this));
    html.find('[data-action="duplicate-network"]').click(this._onDuplicateNetwork.bind(this));
    html.find('[data-action="enable-in-scene"]').click(this._onEnableInCurrentScene.bind(this));
    
    // Scene Tab Actions
    html.find('[data-action="select-scene"]').change(this._onSceneSelect.bind(this));
    html.find('[data-action="toggle-network"]').click(this._onToggleNetwork.bind(this));
    html.find('[data-action="adjust-signal"]').change(this._onAdjustSignal.bind(this));
    html.find('[data-action="enable-all"]').click(this._onEnableAll.bind(this));
    html.find('[data-action="disable-all"]').click(this._onDisableAll.bind(this));
    html.find('[data-action="reset-scene"]').click(this._onResetScene.bind(this));
  }

  /* -------------------------------------------- */
  /*  Tab Management                              */
  /* -------------------------------------------- */

  async _onTabChange(event) {
    event.preventDefault();
    const tab = event.currentTarget.dataset.tab;
    this.activeTab = tab;
    await this.render(false);
  }

  /* -------------------------------------------- */
  /*  Network Tab Actions                         */
  /* -------------------------------------------- */

  async _onCreateNetwork(event) {
    event.preventDefault();
    
    const { default: NetworkEditorDialog } = await import('../../dialogs/NetworkEditorDialog.js');
    
    new NetworkEditorDialog({
      mode: 'create',
      onSave: async (networkData) => {
        const storage = game.nightcity.messenger.networkStorage;
        await storage.createNetwork(networkData);
        
        // Optionally enable in current scene
        if (networkData.enableInCurrentScene && game.scenes.current) {
          const manager = game.nightcity.messenger.networkManager;
          await manager.setNetworkAvailability(networkData.id, true, game.scenes.current);
        }
        
        await this.render(false);
        ui.notifications.info(`Network "${networkData.name}" created`);
      }
    }).render(true);
  }

  async _onEditNetwork(event) {
    event.preventDefault();
    const networkId = event.currentTarget.closest('[data-network-id]').dataset.networkId;
    const storage = game.nightcity.messenger.networkStorage;
    const network = storage.getNetwork(networkId);
    
    if (!network) {
      ui.notifications.error("Network not found");
      return;
    }

    const { default: NetworkEditorDialog } = await import('../../dialogs/NetworkEditorDialog.js');
    
    new NetworkEditorDialog({
      mode: 'edit',
      network: foundry.utils.deepClone(network),
      onSave: async (networkData) => {
        await storage.updateNetwork(networkId, networkData);
        await this.render(false);
        ui.notifications.info(`Network "${networkData.name}" updated`);
        
        // Trigger hook for UI updates
        Hooks.callAll('cyberpunkred-messenger.networkUpdated', networkData);
      }
    }).render(true);
  }

  async _onDeleteNetwork(event) {
    event.preventDefault();
    const networkId = event.currentTarget.closest('[data-network-id]').dataset.networkId;
    const storage = game.nightcity.messenger.networkStorage;
    const network = storage.getNetwork(networkId);
    
    if (!network) return;

    // Confirmation dialog
    const confirm = await Dialog.confirm({
      title: `Delete ${network.name}?`,
      content: `<p>Are you sure you want to delete the network <strong>${network.name}</strong>?</p>
                <p class="notification warning">This will also remove this network from all scene configurations.</p>`,
      yes: () => true,
      no: () => false
    });

    if (!confirm) return;

    // Delete network
    await storage.deleteNetwork(networkId);
    
    // Clean up scene flags
    for (const scene of game.scenes) {
      const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};
      if (sceneNetworks[networkId]) {
        delete sceneNetworks[networkId];
        await scene.setFlag(MODULE_ID, 'networks', sceneNetworks);
      }
    }

    await this.render(false);
    ui.notifications.info(`Network "${network.name}" deleted`);
  }

  async _onDuplicateNetwork(event) {
    event.preventDefault();
    const networkId = event.currentTarget.closest('[data-network-id]').dataset.networkId;
    const storage = game.nightcity.messenger.networkStorage;
    const network = storage.getNetwork(networkId);
    
    if (!network) return;

    // Create duplicate with new ID
    const duplicate = foundry.utils.deepClone(network);
    duplicate.id = foundry.utils.randomID();
    duplicate.name = `${network.name} (Copy)`;
    
    await storage.createNetwork(duplicate);
    await this.render(false);
    ui.notifications.info(`Network duplicated as "${duplicate.name}"`);
  }

  async _onEnableInCurrentScene(event) {
    event.preventDefault();
    const networkId = event.currentTarget.closest('[data-network-id]').dataset.networkId;
    const scene = game.scenes.current;
    
    if (!scene) {
      ui.notifications.warn("No active scene");
      return;
    }

    const manager = game.nightcity.messenger.networkManager;
    await manager.setNetworkAvailability(networkId, true, scene);
    
    const network = game.nightcity.messenger.networkStorage.getNetwork(networkId);
    ui.notifications.info(`${network.name} enabled in ${scene.name}`);
    
    await this.render(false);
  }

  /* -------------------------------------------- */
  /*  Scene Tab Actions                           */
  /* -------------------------------------------- */

  async _onSceneSelect(event) {
    event.preventDefault();
    this.selectedScene = event.target.value;
    await this.render(false);
  }

  async _onToggleNetwork(event) {
    event.preventDefault();
    const networkId = event.currentTarget.dataset.networkId;
    const scene = game.scenes.get(this.selectedScene);
    
    if (!scene) return;

    const sceneNetworks = scene.getFlag(MODULE_ID, 'networks') || {};
    const current = sceneNetworks[networkId]?.available || false;
    
    const manager = game.nightcity.messenger.networkManager;
    await manager.setNetworkAvailability(networkId, !current, scene);
    
    await this.render(false);
  }

  async _onAdjustSignal(event) {
    event.preventDefault();
    const networkId = event.currentTarget.dataset.networkId;
    const strength = parseInt(event.target.value);
    const scene = game.scenes.get(this.selectedScene);
    
    if (!scene) return;

    const manager = game.nightcity.messenger.networkManager;
    await manager.setSignalStrength(networkId, strength, scene);
    
    // Update display without full re-render
    const display = event.currentTarget.parentElement.querySelector('.signal-value');
    if (display) display.textContent = `${strength}%`;
  }

  async _onEnableAll(event) {
    event.preventDefault();
    const scene = game.scenes.get(this.selectedScene);
    
    if (!scene) return;

    const manager = game.nightcity.messenger.networkManager;
    await manager.enableAllNetworks(scene);
    
    await this.render(false);
  }

  async _onDisableAll(event) {
    event.preventDefault();
    const scene = game.scenes.get(this.selectedScene);
    
    if (!scene) return;

    const confirm = await Dialog.confirm({
      title: "Disable All Networks?",
      content: `<p>Disable all networks in <strong>${scene.name}</strong>?</p>
                <p class="notification warning">This will create a dead zone.</p>`,
      yes: () => true,
      no: () => false
    });

    if (!confirm) return;

    const manager = game.nightcity.messenger.networkManager;
    await manager.disableAllNetworks(scene);
    
    await this.render(false);
  }

  async _onResetScene(event) {
    event.preventDefault();
    const scene = game.scenes.get(this.selectedScene);
    
    if (!scene) return;

    const confirm = await Dialog.confirm({
      title: "Reset Scene Configuration?",
      content: `<p>Reset network configuration for <strong>${scene.name}</strong>?</p>
                <p>Networks will use their default visibility settings (defaultHidden flag).</p>`,
      yes: () => true,
      no: () => false
    });

    if (!confirm) return;

    const manager = game.nightcity.messenger.networkManager;
    await manager.resetSceneConfig(scene);
    
    await this.render(false);
  }

  /* -------------------------------------------- */
  /*  Helper Methods                              */
  /* -------------------------------------------- */

  /**
   * Get network configuration status for display
   */
  _getNetworkStatus(network, scene) {
    const sceneNetworks = scene?.getFlag(MODULE_ID, 'networks') || {};
    const config = sceneNetworks[network.id];
    
    if (config?.available) {
      return {
        status: 'enabled',
        label: 'Enabled',
        icon: 'fa-check-circle',
        class: 'status-enabled'
      };
    }
    
    if (config !== undefined && !config.available) {
      return {
        status: 'disabled',
        label: 'Disabled',
        icon: 'fa-times-circle',
        class: 'status-disabled'
      };
    }
    
    // No scene configuration
    if (network.defaultHidden) {
      return {
        status: 'hidden',
        label: 'Hidden by Default',
        icon: 'fa-eye-slash',
        class: 'status-hidden'
      };
    }
    
    return {
      status: 'visible',
      label: 'Visible by Default',
      icon: 'fa-eye',
      class: 'status-visible'
    };
  }
}