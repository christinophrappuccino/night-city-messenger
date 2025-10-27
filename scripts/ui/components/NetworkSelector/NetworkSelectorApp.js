/**
 * Network Selector Application
 * File: scripts/ui/components/NetworkSelector/NetworkSelectorApp.js
 * Module: cyberpunkred-messenger
 * Description: Cyberpunk-styled network selector UI for viewing and switching networks
 */

import { BaseApplication } from '../BaseApplication.js';

export class NetworkSelectorApp extends BaseApplication {
  constructor(options = {}) {
    super(options);
    
    /**
     * @property {boolean} expanded - Whether the network list is expanded
     */
    this.expanded = options.expanded ?? false;
    
    /**
     * @property {boolean} embedded - Whether this is embedded in another UI
     */
    this.embedded = options.embedded ?? false;
    
    /**
     * @property {string} context - Usage context ('message-viewer', 'item-inbox', 'standalone')
     */
    this.context = options.context ?? 'standalone';
    
    /**
     * @property {Array} cachedNetworks - Cached network list
     */
    this.cachedNetworks = null;
    
    /**
     * @property {number} cacheTimestamp - When networks were last cached
     */
    this.cacheTimestamp = 0;
    
    /**
     * @property {number} CACHE_DURATION - Cache duration in milliseconds (30 seconds)
     */
    this.CACHE_DURATION = 30000;
    
    // Subscribe to network events
    this._subscribeToEvents();
  }

  /**
   * @override
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['ncm-network-selector-app'],
      template: 'modules/${MODULE_ID}/templates/network-selector/network-selector.hbs',
      width: 320,
      height: 'auto',
      resizable: false,
      minimizable: false,
      title: 'Network Selector'
    });
  }

  /**
   * Subscribe to network-related events
   * @private
   */
  _subscribeToEvents() {
    const eventBus = game.nightcity?.eventBus;
    if (!eventBus) return;

    // Re-render when network changes
    eventBus.on('network:connected', () => this._onNetworkChanged());
    eventBus.on('network:disconnected', () => this._onNetworkChanged());
    eventBus.on('network:scan:complete', () => this._onNetworkScanComplete());
    eventBus.on('network:authentication:failed', () => this._onAuthFailed());
    
    // Handle scene changes
    Hooks.on('canvasReady', () => this._onSceneChanged());
  }

  /**
   * Get data for template rendering
   * @override
   */
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

    // Get current network status
    const status = networkManager.getNetworkStatus();
    
    // Get available networks (with caching)
    const networks = await this._getNetworks();
    
    // Format current network data
    const currentNetwork = status.connected && networks.length > 0
      ? networks.find(n => n.id === status.networkId)
      : null;

    return {
      ...data,
      expanded: this.expanded,
      embedded: this.embedded,
      context: this.context,
      isGM: game.user.isGM,
      
      // Current connection state
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
      
      // Available networks
      availableNetworks: networks.map(network => ({
        id: network.id,
        name: game.nightcity.NetworkUtils.formatNetworkName(network),
        displayName: network.displayName || network.name,
        description: network.description || '',
        icon: game.nightcity.NetworkUtils.getNetworkTypeIcon(network.type),
        color: this._getNetworkColor(network),
        type: network.type,
        
        // Security and access
        requiresAuth: network.requiresAuth,
        securityLevel: network.security?.level || 'NONE',
        securityIcon: this._getSecurityIcon(network.security?.level),
        isLocked: network.requiresAuth && !this._isAuthenticated(network.id),
        
        // Signal and connection
        signalStrength: this._calculateSignalStrength(network),
        signalBars: game.nightcity.NetworkUtils.generateSignalBars(
          this._calculateSignalStrength(network)
        ),
        isConnected: status.connected && status.networkId === network.id,
        isAvailable: network.available !== false,
        
        // Warnings
        isTraced: network.traced || false,
        isMonitored: network.monitored || false,
        isDangerous: network.type === 'DARKNET' || network.blackICE,
        
        // Metadata
        range: network.range || 100,
        canConnect: this._canConnect(network)
      })),
      
      // UI state
      hasNetworks: networks.length > 0,
      noNetworksMessage: this._getNoNetworksMessage(),
      
      // Actions
      canScan: true,
      canManage: game.user.isGM
    };
  }

  /**
   * Get networks with caching
   * @private
   */
  async _getNetworks() {
    const now = Date.now();
    
    // Return cached if fresh
    if (this.cachedNetworks && (now - this.cacheTimestamp < this.CACHE_DURATION)) {
      return this.cachedNetworks;
    }
    
    // Fetch fresh networks
    const networkManager = game.nightcity.networkManager;
    const networks = await networkManager.getAvailableNetworks();
    
    // Update cache
    this.cachedNetworks = networks;
    this.cacheTimestamp = now;
    
    return networks;
  }

  /**
   * Calculate signal strength for a network
   * @private
   */
  _calculateSignalStrength(network) {
    // Check if network has explicit signal strength
    if (typeof network.signalStrength === 'number') {
      return network.signalStrength;
    }
    
    // Base signal on distance/range
    const range = network.range || 100;
    
    // Full signal for nearby networks
    if (range >= 100) return 100;
    if (range >= 75) return 90;
    if (range >= 50) return 75;
    if (range >= 25) return 60;
    return 40;
  }

  /**
   * Check if user is authenticated to network
   * @private
   */
  _isAuthenticated(networkId) {
    const stateManager = game.nightcity?.stateManager;
    if (!stateManager) return false;
    
    const state = stateManager.getNetworkState();
    return state.authenticatedNetworks?.includes(networkId) || false;
  }

  /**
   * Check if user can connect to network
   * @private
   */
  _canConnect(network) {
    if (!network.available) return false;
    if (!network.requiresAuth) return true;
    return this._isAuthenticated(network.id);
  }

  /**
   * Get network color based on type
   * @private
   */
  _getNetworkColor(network) {
    const colors = {
      'PUBLIC': '#19f3f7',    // Cyan
      'CORPORATE': '#FFA500',  // Orange
      'DARKNET': '#9D4EDD',    // Purple
      'DEAD_ZONE': '#666666',  // Gray
      'CUSTOM': '#F65261'      // Red
    };
    
    return network.color || colors[network.type] || colors.CUSTOM;
  }

  /**
   * Get security level icon
   * @private
   */
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

  /**
   * Get connection status text
   * @private
   */
  _getConnectionStatus(network, status) {
    if (!status.connected) return 'Disconnected';
    if (status.signalStrength < 30) return 'Weak Signal';
    if (status.signalStrength < 60) return 'Fair Signal';
    if (status.signalStrength < 90) return 'Good Signal';
    return 'Connected';
  }

  /**
   * Get message when no networks available
   * @private
   */
  _getNoNetworksMessage() {
    const scene = game.scenes?.active;
    if (!scene) return 'No scene active';
    
    return 'No networks in range. Try scanning or moving to a different location.';
  }

  /**
   * Activate event listeners
   * @override
   */
  activateListeners(html) {
    super.activateListeners(html);

    // Toggle expansion
    html.find('.ncm-network-current').click(() => this._onToggleExpand());
    
    // Network selection
    html.find('.ncm-network-item').click((event) => {
      const networkId = $(event.currentTarget).data('network-id');
      this._onNetworkClick(networkId);
    });
    
    // Scan button
    html.find('[data-action="scan"]').click(() => this._onScan());
    
    // Manage button (GM only)
    html.find('[data-action="manage"]').click(() => this._onManage());
    
    // Close button (if standalone)
    html.find('[data-action="close"]').click(() => this.close());
  }

  /**
   * Toggle network list expansion
   * @private
   */
  async _onToggleExpand() {
    this.expanded = !this.expanded;
    
    // Add animation class
    const element = this.element;
    if (element) {
      element.addClass('expanding');
      setTimeout(() => element.removeClass('expanding'), 300);
    }
    
    await this.render();
  }

  /**
   * Handle network item click
   * @private
   */
  async _onNetworkClick(networkId) {
    if (!networkId) return;
    
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
    
    // Check if network is available
    if (!network.available) {
      ui.notifications.warn(`${network.displayName || network.name} is out of range`);
      return;
    }
    
    // Add switching animation
    this._addSwitchingAnimation();
    
    // Check if authentication required
    if (network.requiresAuth && !this._isAuthenticated(networkId)) {
      // Show authentication dialog
      const { NetworkAuthDialog } = await import('../dialogs/NetworkAuthDialog.js');
      const dialog = new NetworkAuthDialog(network, {
        onSuccess: async () => {
          await this._connectToNetwork(networkId);
        }
      });
      dialog.render(true);
    } else {
      // Direct connection
      await this._connectToNetwork(networkId);
    }
  }

  /**
   * Connect to a network
   * @private
   */
  async _connectToNetwork(networkId, password = null) {
    const networkManager = game.nightcity.networkManager;
    
    try {
      await networkManager.connectToNetwork(networkId, password);
      
      // Success feedback
      const networks = await this._getNetworks();
      const network = networks.find(n => n.id === networkId);
      const networkName = network ? (network.displayName || network.name) : networkId;
      
      ui.notifications.info(`Connected to ${networkName}`);
      
      // Collapse after successful connection
      if (this.embedded) {
        this.expanded = false;
      }
      
      await this.render();
    } catch (error) {
      console.error('NCM | Failed to connect to network:', error);
      ui.notifications.error(`Connection failed: ${error.message}`);
    }
  }

  /**
   * Handle scan button click
   * @private
   */
  async _onScan() {
    const networkManager = game.nightcity.networkManager;
    
    // Visual feedback
    const button = this.element?.find('[data-action="scan"]');
    if (button) {
      button.prop('disabled', true);
      button.html('<i class="fas fa-spinner fa-spin"></i> Scanning...');
    }
    
    try {
      const networks = await networkManager.scanNetworks();
      
      // Clear cache to force refresh
      this.cachedNetworks = null;
      
      ui.notifications.info(`Network scan complete. Found ${networks.length} network(s).`);
      await this.render();
    } catch (error) {
      console.error('NCM | Network scan failed:', error);
      ui.notifications.error('Network scan failed');
    }
  }

  /**
   * Handle manage button click (GM only)
   * @private
   */
  async _onManage() {
    if (!game.user.isGM) return;
    
    // TODO: Open network management panel (Phase 5)
    ui.notifications.info('Network Management panel coming in Phase 5');
  }

  /**
   * Add switching animation
   * @private
   */
  _addSwitchingAnimation() {
    const element = this.element;
    if (!element) return;
    
    element.addClass('switching');
    setTimeout(() => element.removeClass('switching'), 500);
  }

  /**
   * Handle network changed event
   * @private
   */
  async _onNetworkChanged() {
    // Clear cache
    this.cachedNetworks = null;
    
    // Re-render
    await this.render();
  }

  /**
   * Handle network scan complete event
   * @private
   */
  async _onNetworkScanComplete() {
    // Clear cache
    this.cachedNetworks = null;
    
    // Re-render
    await this.render();
    
    // Visual feedback
    const element = this.element;
    if (element) {
      element.addClass('scan-pulse');
      setTimeout(() => element.removeClass('scan-pulse'), 1000);
    }
  }

  /**
   * Handle authentication failed event
   * @private
   */
  async _onAuthFailed() {
    // Shake animation
    const element = this.element;
    if (element) {
      element.addClass('auth-failed');
      setTimeout(() => element.removeClass('auth-failed'), 500);
    }
  }

  /**
   * Handle scene changed
   * @private
   */
  async _onSceneChanged() {
    // Clear cache
    this.cachedNetworks = null;
    
    // Auto-scan on scene change
    if (game.nightcity?.networkManager) {
      await game.nightcity.networkManager.scanNetworks();
    }
    
    // Re-render
    await this.render();
  }

  /**
   * Clean up when app is closed
   * @override
   */
  async close(options = {}) {
    // Unsubscribe from events if needed
    // (EventBus handles this automatically)
    
    return super.close(options);
  }
}