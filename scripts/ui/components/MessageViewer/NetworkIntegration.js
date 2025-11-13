/**
 * MessageViewer Network Integration
 * File: scripts/ui/components/MessageViewer/NetworkIntegration.js
 * Module: cyberpunkred-messenger
 * 
 * Handles network selector integration for MessageViewerApp
 */

import { MODULE_ID } from '../../../utils/constants.js';

export class MessageViewerNetworkIntegration {
  
  /**
   * Add network selector to MessageViewer
   */
  static addNetworkSelector(html, app) {
    const networkManager = game.nightcity?.networkManager;
    if (!networkManager) return;
    
    // Find the network status indicator element
    const networkIndicator = html.find('.ncm-network-status-indicator');
    if (!networkIndicator.length) return;
    
    // Add click handler for network switching
    networkIndicator.on('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      
      // Create a simple network selector dialog
      await this.showNetworkSelector(app);
    });
    
    // Update the current network display
    this.updateNetworkDisplay(html);
  }
  
  /**
   * Update network display in the viewer
   */
  static updateNetworkDisplay(html) {
    const networkManager = game.nightcity?.networkManager;
    if (!networkManager) return;
    
    const status = networkManager.getNetworkStatus();
    const networkName = html.find('.network-name');
    const networkIcon = html.find('.network-icon');
    const signalBars = html.find('.ncm-network-signal');
    
    if (status.connected && status.networkId) {
      // Get network details
      networkManager.getAllNetworks().then(networks => {
        const currentNetwork = networks.find(n => n.id === status.networkId);
        if (currentNetwork) {
          networkName.text(currentNetwork.name);
          networkIcon.removeClass().addClass(`network-icon fas ${currentNetwork.icon}`);
          networkIcon.css('color', currentNetwork.color);
        }
      });
    } else {
      networkName.text('Disconnected');
      networkIcon.removeClass().addClass('network-icon fas fa-signal-slash');
      networkIcon.css('color', '#666');
    }
  }
  
  /**
   * Show network selector dialog
   */
  static async showNetworkSelector(app) {
    const networkManager = game.nightcity?.networkManager;
    if (!networkManager) return;
    
    const networks = await networkManager.getAvailableNetworks();
    const currentStatus = networkManager.getNetworkStatus();
    
    // Build network list HTML
    let content = `
      <div class="ncm-network-selector-dialog">
        <h3>Select Network</h3>
        <div class="network-list">
    `;
    
    for (const network of networks) {
      const isConnected = currentStatus.connected && network.id === currentStatus.networkId;
      const requiresAuth = network.requiresAuth && !networkManager.isAuthenticated(network.id);
      
      content += `
        <div class="network-option ${isConnected ? 'connected' : ''}" data-network-id="${network.id}">
          <i class="fas ${network.icon}" style="color: ${network.color}"></i>
          <span class="network-name">${network.name}</span>
          ${isConnected ? '<i class="fas fa-check-circle connected-icon"></i>' : ''}
          ${requiresAuth ? '<i class="fas fa-lock locked-icon"></i>' : ''}
          <div class="signal-strength">Signal: ${network.signal || 100}%</div>
        </div>
      `;
    }
    
    content += `
        </div>
      </div>
    `;
    
    // Create dialog
    new Dialog({
      title: 'Network Selection',
      content: content,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close'
        }
      },
      render: html => {
        // Add click handlers for network options
        html.find('.network-option').on('click', async (event) => {
          const networkId = event.currentTarget.dataset.networkId;
          
          // Attempt connection
          const success = await networkManager.connectToNetwork(networkId);
          
          if (success) {
            ui.notifications.info(`Connected to network`);
            
            // Update the message viewer
            if (app && app.render) {
              app.render(false);
            }
            
            // Close dialog
            html.closest('.dialog').find('.dialog-button.close').click();
          }
        });
      }
    }).render(true);
  }
  
  /**
   * Handle network change events
   */
  static setupNetworkListeners(app) {
    const eventBus = game.nightcity?.eventBus;
    if (!eventBus) return;
    
    // Listen for network changes
    const handlers = [];
    
    handlers.push(
      eventBus.on('network:connected', (data) => {
        console.log(`${MODULE_ID} | Network connected in MessageViewer:`, data);
        if (app.rendered) {
          app.render(false);
        }
      })
    );
    
    handlers.push(
      eventBus.on('network:disconnected', (data) => {
        console.log(`${MODULE_ID} | Network disconnected in MessageViewer`);
        if (app.rendered) {
          app.render(false);
        }
      })
    );
    
    // Store handlers for cleanup
    app._networkHandlers = handlers;
  }
  
  /**
   * Clean up network listeners
   */
  static cleanupNetworkListeners(app) {
    if (app._networkHandlers) {
      const eventBus = game.nightcity?.eventBus;
      if (eventBus) {
        app._networkHandlers.forEach(handler => {
          eventBus.off(handler);
        });
      }
      app._networkHandlers = null;
    }
  }
}

/**
 * Hook into MessageViewerApp
 */
Hooks.on('renderMessageViewerApp', (app, html, data) => {
  MessageViewerNetworkIntegration.addNetworkSelector(html, app);
  MessageViewerNetworkIntegration.setupNetworkListeners(app);
});

Hooks.on('closeMessageViewerApp', (app) => {
  MessageViewerNetworkIntegration.cleanupNetworkListeners(app);
});