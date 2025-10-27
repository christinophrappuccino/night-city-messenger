/**
 * Network Selector Dialog - FIXED
 * File: scripts/ui/dialogs/NetworkSelectorDialog.js
 * Module: cyberpunkred-messenger
 * 
 * FIX: getAvailableNetworks() is async - must await it!
 */

import { MODULE_ID } from '../../utils/constants.js';

export class NetworkSelectorDialog {
  
  /**
   * Open the network selector dialog
   * @static
   */
  static async open() {
    const dialog = new NetworkSelectorDialog();
    await dialog.render();
  }
  
  /**
   * Render the dialog
   */
  async render() {
    const networkManager = game.nightcity?.networkManager;
    
    if (!networkManager) {
      ui.notifications.error('Network system not initialized');
      return;
    }
    
    // Get current status
    const currentStatus = networkManager.getNetworkStatus() || {};
    
    // CRITICAL: Await the networks array
    const networks = await networkManager.getAvailableNetworks() || [];
    
    console.log(`${MODULE_ID} | Found ${networks.length} networks`, networks);
    
    // Build network list HTML
    const networkListHTML = networks.map(network => {
      const isConnected = network.id === currentStatus.networkId;
      
      // Calculate signal strength
      const signalStrength = this._calculateSignalStrength(network);
      const signalBars = game.nightcity?.NetworkUtils?.generateSignalBars(signalStrength) || '';
      
      return `
        <div class="ncm-network-dialog-item ${isConnected ? 'connected' : ''}" 
             data-network-id="${network.id}"
             title="${network.description || ''}">
          <div class="network-item-icon" style="color: ${network.theme?.primaryColor || '#19f3f7'};">
            <i class="fas ${this._getNetworkIcon(network)}"></i>
          </div>
          <div class="network-item-details">
            <div class="network-item-name">
              ${network.displayName || network.name}
              ${isConnected ? '<span class="connected-badge">✓ CONNECTED</span>' : ''}
            </div>
            <div class="network-item-type">${network.type}</div>
            ${network.description ? `<div class="network-item-desc">${network.description}</div>` : ''}
            ${network.security?.requiresAuth ? 
              `<div class="network-item-security">🔒 ${network.security.level || 'SECURED'}</div>` : ''}
          </div>
          <div class="network-item-signal">
            ${signalBars}
            <span>${signalStrength}%</span>
          </div>
        </div>
      `;
    }).join('');
    
    const content = `
      <div class="ncm-network-selector-dialog">
        <div class="current-connection">
          <div class="current-connection-header">
            <i class="fas fa-wifi"></i>
            <span>CURRENT CONNECTION</span>
          </div>
          <div class="current-connection-details">
            <div class="current-network-name">${currentStatus.networkId || 'None'}</div>
            <div class="current-network-status">
              ${currentStatus.connected ? 
                `<span class="status-connected">Connected • ${currentStatus.signalStrength || 100}% Signal</span>` : 
                `<span class="status-disconnected">Disconnected</span>`
              }
            </div>
          </div>
        </div>
        
        <div class="network-list-section">
          <div class="network-list-header">
            <span>AVAILABLE NETWORKS</span>
            <span class="network-count">${networks.length}</span>
          </div>
          
          ${networks.length > 0 ? 
            `<div class="network-list">${networkListHTML}</div>` :
            `<div class="network-list-empty">
              <i class="fas fa-satellite-dish"></i>
              <p>No networks in range</p>
              <p class="hint">Click "Scan Networks" to search</p>
            </div>`
          }
        </div>
        
        <div class="network-actions">
          ${currentStatus.connected ? 
            `<button class="ncm-btn ncm-btn--secondary" data-action="disconnect">
              <i class="fas fa-times"></i> Disconnect
            </button>` : ''
          }
          <button class="ncm-btn ncm-btn--primary" data-action="scan">
            <i class="fas fa-sync-alt"></i> Scan Networks
          </button>
        </div>
      </div>
    `;
    
    // Create Foundry Dialog
    new Dialog({
      title: "Network Selector",
      content: content,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: "Close"
        }
      },
      default: "close",
      render: html => this._activateListeners(html)
    }, {
      classes: ['dialog', 'ncm-dialog', 'ncm-network-selector-dialog'],
      width: 500,
      height: 'auto'
    }).render(true);
  }
  
  /**
   * Activate event listeners
   * @private
   */
  _activateListeners(html) {
    const networkManager = game.nightcity?.networkManager;
    
    // Network item click - connect to network
    html.find('.ncm-network-dialog-item').click(async function() {
      const networkId = $(this).data('network-id');
      if (!networkId) return;
      
      if (!networkManager) {
        ui.notifications.error('Network system not available');
        return;
      }
      
      try {
        const result = await networkManager.connectToNetwork(networkId);
        
        if (result.success) {
          ui.notifications.info(`Connected to ${networkId}`);
          
          // Close dialog
          html.closest('.dialog').find('.dialog-button').click();
          
          // Refresh any open apps
          Object.values(ui.windows).forEach(app => {
            if (app.render && typeof app.render === 'function') {
              app.render(false);
            }
          });
        } else if (result.requiresAuth) {
          ui.notifications.warn(`${networkId} requires authentication`);
          // Could open auth dialog here
        } else {
          ui.notifications.error(result.error || 'Failed to connect');
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Connection error:`, error);
        ui.notifications.error(`Failed to connect: ${error.message}`);
      }
    });
    
    // Disconnect button
    html.find('[data-action="disconnect"]').click(async function() {
      if (!networkManager) return;
      
      await networkManager.disconnect();
      ui.notifications.info('Disconnected from network');
      
      // Close dialog
      html.closest('.dialog').find('.dialog-button').click();
      
      // Refresh apps
      Object.values(ui.windows).forEach(app => {
        if (app.render) app.render(false);
      });
    });
    
    // Scan button
    html.find('[data-action="scan"]').click(async function() {
      if (!networkManager) return;
      
      ui.notifications.info('Scanning for networks...');
      
      try {
        await networkManager.scanNetworks();
        ui.notifications.info('Scan complete');
        
        // Reopen dialog with new results
        html.closest('.dialog').find('.dialog-button').click();
        
        // Wait a moment then reopen
        setTimeout(() => {
          NetworkSelectorDialog.open();
        }, 100);
      } catch (error) {
        console.error(`${MODULE_ID} | Scan error:`, error);
        ui.notifications.error('Scan failed');
      }
    });
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
    
    // Use range to estimate signal
    const range = network.range || 100;
    if (range >= 100) return 100;
    if (range >= 75) return 90;
    if (range >= 50) return 75;
    if (range >= 25) return 60;
    return 40;
  }
  
  /**
   * Get icon for network type
   * @private
   */
  _getNetworkIcon(network) {
    const iconMap = {
      'public': 'fa-wifi',
      'corporate': 'fa-building',
      'darknet': 'fa-user-secret',
      'private': 'fa-lock',
      'military': 'fa-shield-alt',
      'custom': 'fa-network-wired'
    };
    
    return iconMap[network.type?.toLowerCase()] || 'fa-wifi';
  }
}