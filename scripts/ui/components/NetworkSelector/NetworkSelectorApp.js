/**
 * Network Selector Application
 * File: scripts/ui/components/NetworkSelector/NetworkSelectorApp.js
 * Module: cyberpunkred-messenger
 * Description: Cyberpunk-styled network selector UI for viewing and switching networks
 */

import { MODULE_ID } from '../../../utils/constants.js';

export class NetworkSelectorApp extends Application {
  constructor(options = {}) {
    super(options);
    
    this.expanded = options.expanded ?? false;
    this.embedded = options.embedded ?? false;
    this.context = options.context ?? 'standalone';
    this.cachedNetworks = null;
    this.cacheTimestamp = 0;
    this.CACHE_DURATION = 30000;
    
    this._subscribeToEvents();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['ncm-network-selector-app'],
      template: `modules/${MODULE_ID}/templates/network-selector/network-selector.hbs`,
      width: 320,
      height: 'auto',
      resizable: false,
      minimizable: false,
      title: 'Network Selector',
      popOut: true
    });
  }

  _subscribeToEvents() {
    const eventBus = game.nightcity?.eventBus;
    if (!eventBus) return;

    eventBus.on('network:connected', () => this._onNetworkChanged());
    eventBus.on('network:disconnected', () => this._onNetworkChanged());
    eventBus.on('network:scan:complete', () => this._onNetworkScanComplete());
    eventBus.on('network:authentication:failed', () => this._onAuthFailed());
    
    Hooks.on('canvasReady', () => this._onSceneChanged());
  }

  async getData() {
    const data = await super.getData();
    const networkManager = game.nightcity?.networkManager;
    
    if (!networkManager) {
      console.error('NCM | NetworkSelectorApp: NetworkManager not available');
      return {
        ...data,
        error: true,
        errorMessage: 'Network system not initialized'
      };
    }

    const status = networkManager.getNetworkStatus();
    const networks = await this._getNetworks();
    const currentNetwork = status.connected && networks.length > 0
      ? networks.find(n => n.id === status.networkId)
      : null;

    return {
      ...data,
      expanded: this.expanded,
      embedded: this.embedded,
      context: this.context,
      isGM: game.user.isGM,
      connected: status.connected,
      currentNetwork: currentNetwork ? {
        id: currentNetwork.id,
        name: game.nightcity.NetworkUtils.formatNetworkName(currentNetwork),
        displayName: currentNetwork.displayName || currentNetwork.name,
        icon: game.nightcity.NetworkUtils.getNetworkTypeIcon(currentNetwork.type),
        color: this._getNetworkColor(currentNetwork),
        signalStrength: status.signalStrength,
        signalBars: game.nightcity.NetworkUtils.generateSignalBars(status.signalStrength),
        status: this._getConnectionStatus(currentNetwork, status),
        isTraced: currentNetwork.traced || false,
        isMonitored: currentNetwork.monitored || false
      } : null,
      availableNetworks: networks.map(network => ({
        id: network.id,
        name: game.nightcity.NetworkUtils.formatNetworkName(network),
        displayName: network.displayName || network.name,
        description: network.description || '',
        icon: game.nightcity.NetworkUtils.getNetworkTypeIcon(network.type),
        color: this._getNetworkColor(network),
        type: network.type,
        requiresAuth: network.requiresAuth,
        securityLevel: network.security?.level || 'NONE',
        securityIcon: this._getSecurityIcon(network.security?.level),
        isLocked: network.requiresAuth && !this._isAuthenticated(network.id),
        signalStrength: this._calculateSignalStrength(network),
        signalBars: game.nightcity.NetworkUtils.generateSignalBars(
          this._calculateSignalStrength(network)
        ),
        isConnected: status.connected && status.networkId === network.id,
        isAvailable: network.available !== false,
        isTraced: network.traced || false,
        isMonitored: network.monitored || false,
        isDangerous: network.type === 'DARKNET' || network.blackICE,
        range: network.range || 100,
        canConnect: this._canConnect(network)
      })),
      hasNetworks: networks.length > 0,
      noNetworksMessage: this._getNoNetworksMessage(),
      canScan: true,
      canManage: game.user.isGM
    };
  }

  async _getNetworks() {
    const now = Date.now();
    if (this.cachedNetworks && (now - this.cacheTimestamp < this.CACHE_DURATION)) {
      return this.cachedNetworks;
    }
    const networkManager = game.nightcity.networkManager;
    const networks = await networkManager.getAvailableNetworks();
    this.cachedNetworks = networks;
    this.cacheTimestamp = now;
    return networks;
  }

  _calculateSignalStrength(network) {
    if (typeof network.signalStrength === 'number') {
      return network.signalStrength;
    }
    const range = network.range || 100;
    if (range >= 100) return 100;
    if (range >= 75) return 90;
    if (range >= 50) return 75;
    if (range >= 25) return 60;
    return 40;
  }

  _isAuthenticated(networkId) {
    const stateManager = game.nightcity?.stateManager;
    if (!stateManager) return false;
    const state = stateManager.getState ? stateManager.getState() : stateManager;
    return state.authenticatedNetworks?.includes(networkId) || false;
  }

  _canConnect(network) {
    if (!network.available) return false;
    if (!network.requiresAuth) return true;
    return this._isAuthenticated(network.id);
  }

  _getNetworkColor(network) {
    const colors = {
      'PUBLIC': '#19f3f7',
      'CORPORATE': '#FFA500',
      'DARKNET': '#9D4EDD',
      'DEAD_ZONE': '#666666',
      'CUSTOM': '#F65261'
    };
    return network.color || colors[network.type] || colors.CUSTOM;
  }

  _getSecurityIcon(level) {
    const icons = {
      'NONE': 'fa-unlock',
      'LOW': 'fa-lock',
      'MEDIUM': 'fa-lock',
      'HIGH': 'fa-shield-alt',
      'MAXIMUM': 'fa-shield-alt'
    };
    return icons[level] || 'fa-question';
  }

  _getConnectionStatus(network, status) {
    if (!status.connected) return 'Disconnected';
    if (status.signalStrength < 30) return 'Weak Signal';
    if (status.signalStrength < 60) return 'Fair Signal';
    if (status.signalStrength < 90) return 'Good Signal';
    return 'Connected';
  }

  _getNoNetworksMessage() {
    const scene = game.scenes?.active;
    if (!scene) return 'No scene active';
    return 'No networks in range. Try scanning or moving to a different location.';
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('.ncm-network-current').click(() => this._onToggleExpand());
    html.find('.ncm-network-item').click((event) => {
      const networkId = $(event.currentTarget).data('network-id');
      this._onNetworkClick(networkId);
    });
    html.find('[data-action="scan"]').click(() => this._onScan());
    html.find('[data-action="manage"]').click(() => this._onManage());
    html.find('[data-action="close"]').click(() => this.close());
      // GM right-click menu
      if (game.user.isGM) {
        html.find('.ncm-network-item').on('contextmenu', async (event) => {
          event.preventDefault();
          
          const networkId = $(event.currentTarget).data('network-id');
          const actor = game.user.character;
          
          if (!actor) {
            ui.notifications.warn('Select a character first');
            return;
          }
          
          const options = [
            {
              name: 'Force Unlock',
              icon: '<i class="fas fa-unlock-alt"></i>',
              callback: async () => {
                await game.nightcity.networkManager.gmUnlockNetwork(actor, networkId);
                this.render();
              }
            },
            {
              name: 'Reset Authentication',
              icon: '<i class="fas fa-redo"></i>',
              callback: async () => {
                await game.nightcity.networkManager.gmResetAuthentication(actor, networkId);
                this.render();
              }
            }
          ];
          
          new ContextMenu(html, '.ncm-network-item', options);
      });
    }
  }

  async _onToggleExpand() {
    this.expanded = !this.expanded;
    const element = this.element;
    if (element) {
      element.addClass('expanding');
      setTimeout(() => element.removeClass('expanding'), 300);
    }
    await this.render();
  }

  async _onNetworkClick(networkId) {
    const networkManager = game.nightcity.networkManager;
    const networks = await this._getNetworks();
    const network = networks.find(n => n.id === networkId);
    
    if (!network) {
      ui.notifications.error('Network not found');
      return;
    }
    
    // Check if already connected
    const status = networkManager.getNetworkStatus();
    if (status.connected && status.networkId === networkId) {
      ui.notifications.info(`Already connected to ${network.displayName || network.name}`);
      return;
    }
    
    // Check if available
    if (!network.available) {
      ui.notifications.warn(`${network.displayName || network.name} is out of range`);
      return;
    }
    
    // Check if authentication required
    if (network.requiresAuth && !this._isAuthenticated(networkId)) {
      // Open authentication dialog
      const { NetworkAuthDialog } = await import('../../dialogs/NetworkAuthDialog.js');
      const dialog = new NetworkAuthDialog(network, {
        actor: game.user.character,
        onSuccess: async () => {
          // After successful auth, connect
          await this._connectToNetwork(networkId);
        }
      });
      dialog.render(true);
    } else {
      // No auth needed or already authenticated
      await this._connectToNetwork(networkId);
    }
  }

  // Add helper method:
  _isAuthenticated(networkId) {
    const actor = game.user.character;
    if (!actor) return false;
    
    const securityService = game.nightcity?.networkSecurityService;
    if (!securityService) return false;
    
    const status = securityService.checkAuthentication(actor, networkId);
    return status.authenticated;
  }

  // Connect helper:
  async _connectToNetwork(networkId) {
    const networkManager = game.nightcity.networkManager;
    
    try {
      const result = await networkManager.connectToNetwork(networkId);
      
      if (result.success) {
        ui.notifications.info(`Connected to network`);
        this.close(); // Close selector
        
        // Refresh any open apps
        Object.values(ui.windows).forEach(app => {
          if (app.render) app.render(false);
        });
      } else if (result.requiresAuth) {
        ui.notifications.warn('Authentication required');
      } else {
        ui.notifications.error(result.error || 'Connection failed');
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Connection error:`, error);
      ui.notifications.error(`Failed to connect: ${error.message}`);
    }
  }

  async _connectToNetwork(networkId, password = null) {
    const networkManager = game.nightcity.networkManager;
    try {
      await networkManager.connectToNetwork(networkId, password);
      const networks = await this._getNetworks();
      const network = networks.find(n => n.id === networkId);
      const networkName = network ? (network.displayName || network.name) : networkId;
      ui.notifications.info(`Connected to ${networkName}`);
      if (this.embedded) {
        this.expanded = false;
      }
      await this.render();
    } catch (error) {
      console.error('NCM | Failed to connect to network:', error);
      ui.notifications.error(`Connection failed: ${error.message}`);
    }
  }

  async _onScan() {
    const networkManager = game.nightcity.networkManager;
    const button = this.element?.find('[data-action="scan"]');
    if (button) {
      button.prop('disabled', true);
      button.html('<i class="fas fa-spinner fa-spin"></i> Scanning...');
    }
    try {
      const networks = await networkManager.scanNetworks();
      this.cachedNetworks = null;
      ui.notifications.info(`Network scan complete. Found ${networks.length} network(s).`);
      await this.render();
    } catch (error) {
      console.error('NCM | Network scan failed:', error);
      ui.notifications.error('Network scan failed');
    }
  }

  async _onManage() {
    if (!game.user.isGM) return;
    ui.notifications.info('Network Management panel coming in Phase 5');
  }

  _addSwitchingAnimation() {
    const element = this.element;
    if (!element) return;
    element.addClass('switching');
    setTimeout(() => element.removeClass('switching'), 500);
  }

  async _onNetworkChanged() {
    this.cachedNetworks = null;
    await this.render();
  }

  async _onNetworkScanComplete() {
    this.cachedNetworks = null;
    await this.render();
    const element = this.element;
    if (element) {
      element.addClass('scan-pulse');
      setTimeout(() => element.removeClass('scan-pulse'), 1000);
    }
  }

  async _onAuthFailed() {
    const element = this.element;
    if (element) {
      element.addClass('auth-failed');
      setTimeout(() => element.removeClass('auth-failed'), 500);
    }
  }

  async _onSceneChanged() {
    this.cachedNetworks = null;
    if (game.nightcity?.networkManager) {
      await game.nightcity.networkManager.scanNetworks();
    }
    await this.render();
  }

  async close(options = {}) {
    return super.close(options);
  }
}