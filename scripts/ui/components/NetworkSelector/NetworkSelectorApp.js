/**
 * Network Selector Application - Streamlined
 * File: scripts/ui/components/NetworkSelector/NetworkSelectorApp.js
 * Module: cyberpunkred-messenger
 * Description: Simplified network selector UI for players
 */

import { MODULE_ID } from '../../../utils/constants.js';

export class NetworkSelectorApp extends Application {
  constructor(options = {}) {
    super(options);
    
    this.networkManager = game.nightcity?.networkManager;
    this._refreshInterval = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['ncm-network-selector'],
      template: `modules/${MODULE_ID}/templates/network-selector/network-selector.hbs`,
      width: 360,
      height: 'auto',
      resizable: false,
      minimizable: true,
      title: 'Network Selection'
    });
  }

  async getData() {
    const data = await super.getData();
    
    if (!this.networkManager) {
      return {
        ...data,
        error: true,
        errorMessage: 'Network system not initialized'
      };
    }
    
    // Get available networks and current status
    const networks = await this.networkManager.getAvailableNetworks();
    const status = this.networkManager.getNetworkStatus();
    const currentNetwork = status.connected ? 
      networks.find(n => n.id === status.networkId) : null;
    
    // Prepare network display data
    const networkData = networks.map(network => ({
      ...network,
      signalBars: this._getSignalBars(network.signal),
      signalQuality: this._getSignalQuality(network.signal),
      isAuthenticated: this.networkManager.isAuthenticated(network.id),
      isConnected: status.connected && network.id === status.networkId,
      canConnect: network.signal > 0
    }));
    
    // Sort by signal strength
    networkData.sort((a, b) => {
      if (a.isConnected) return -1;
      if (b.isConnected) return 1;
      return b.signal - a.signal;
    });
    
    return {
      ...data,
      networks: networkData,
      currentNetwork,
      connected: status.connected,
      hasCharacter: !!game.user.character,
      isGM: game.user.isGM
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    
    // Network connection
    html.find('.network-item').click(this._onNetworkClick.bind(this));
    
    // Quick actions
    html.find('.disconnect-btn').click(this._onDisconnect.bind(this));
    html.find('.refresh-btn').click(this._onRefresh.bind(this));
    html.find('.manage-btn').click(this._onManage.bind(this));
    
    // Start auto-refresh
    this._startAutoRefresh();
  }

  async _onNetworkClick(event) {
    event.preventDefault();
    const networkId = event.currentTarget.dataset.networkId;
    
    // Check if already connected
    const status = this.networkManager.getNetworkStatus();
    if (status.connected && status.networkId === networkId) {
      ui.notifications.info('Already connected to this network');
      return;
    }
    
    // Add connecting animation
    const element = $(event.currentTarget);
    element.addClass('connecting');
    
    try {
      const success = await this.networkManager.connectToNetwork(networkId);
      
      if (success) {
        element.removeClass('connecting').addClass('connect-success');
        setTimeout(() => {
          this.render(false);
        }, 500);
      } else {
        element.removeClass('connecting').addClass('connect-fail');
        setTimeout(() => {
          element.removeClass('connect-fail');
        }, 1000);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Connection error:`, error);
      element.removeClass('connecting');
    }
  }

  async _onDisconnect(event) {
    event.preventDefault();
    
    const confirm = await Dialog.confirm({
      title: 'Disconnect from Network',
      content: '<p>Are you sure you want to disconnect?</p>'
    });
    
    if (confirm) {
      await this.networkManager.disconnect();
      this.render(false);
    }
  }

  async _onRefresh(event) {
    event.preventDefault();
    
    const button = $(event.currentTarget);
    button.addClass('spinning');
    
    await this.networkManager.scanNetworks();
    
    setTimeout(() => {
      button.removeClass('spinning');
      this.render(false);
    }, 1000);
  }

  async _onManage(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.warn('Only GMs can manage networks');
      return;
    }
    
    game.nightcity.openNetworkManagement();
  }

  _startAutoRefresh() {
    if (this._refreshInterval) clearInterval(this._refreshInterval);
    
    this._refreshInterval = setInterval(() => {
      if (this.rendered) {
        this.render(false);
      }
    }, 5000); // Refresh every 5 seconds
  }

  async close(options) {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
    return super.close(options);
  }

  /* -------------------------------------------- */
  /*  Utility Methods                             */
  /* -------------------------------------------- */

  _getSignalBars(strength) {
    const bars = Math.ceil((strength / 100) * 4);
    let html = '<div class="signal-bars">';
    for (let i = 1; i <= 4; i++) {
      const active = i <= bars ? 'active' : '';
      html += `<span class="bar ${active}"></span>`;
    }
    html += '</div>';
    return html;
  }

  _getSignalQuality(strength) {
    if (strength >= 80) return { label: 'Excellent', class: 'excellent' };
    if (strength >= 60) return { label: 'Good', class: 'good' };
    if (strength >= 40) return { label: 'Fair', class: 'fair' };
    if (strength >= 20) return { label: 'Poor', class: 'poor' };
    return { label: 'No Signal', class: 'none' };
  }
}

// Static method for quick open
NetworkSelectorApp.open = function() {
  const existing = Object.values(ui.windows).find(w => 
    w instanceof NetworkSelectorApp
  );
  
  if (existing) {
    existing.bringToTop();
    return existing;
  }
  
  const selector = new NetworkSelectorApp();
  selector.render(true);
  return selector;
};