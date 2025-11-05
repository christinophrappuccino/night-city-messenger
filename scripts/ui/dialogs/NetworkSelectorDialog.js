/**
 * Network Selector Dialog - FIXED
 * File: scripts/ui/dialogs/NetworkSelectorDialog.js
 * Module: cyberpunkred-messenger
 * 
 * FIXES:
 * 1. getAvailableNetworks() is async - must await it!
 * 2. Actually show NetworkAuthDialog when auth is required (line 173)
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
            ${network.security?.requiresAuth || network.requiresAuth ? 
              `<div class="network-item-security">🔒 ${network.security?.level || 'SECURED'}</div>` : ''}
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
                '<span class="status-connected">● ONLINE</span>' : 
                '<span class="status-disconnected">● OFFLINE</span>'}
            </div>
          </div>
        </div>
        
        <div class="available-networks-section">
          <div class="available-networks-header">
            <span>AVAILABLE NETWORKS</span>
            <button class="scan-networks-btn" data-action="scan" title="Scan for networks">
              <i class="fas fa-radar"></i> SCAN
            </button>
          </div>
          <div class="network-list">
            ${networkListHTML || '<div class="no-networks">No networks available</div>'}
          </div>
        </div>
        
        <div class="dialog-actions">
          <button class="disconnect-btn" data-action="disconnect" ${!currentStatus.connected ? 'disabled' : ''}>
            <i class="fas fa-unlink"></i> Disconnect
          </button>
        </div>
      </div>
    `;
    
    // Show dialog
    new Dialog({
      title: "Network Selector",
      content: content,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: "Close"
        }
      },
      render: (html) => this._activateListeners(html, networkManager),
      default: "close"
    }, {
      classes: ['ncm-network-selector-dialog'],
      width: 600,
      height: 'auto'
    }).render(true);
  }
  
  /**
   * Activate event listeners
   * @private
   */
  _activateListeners(html, networkManager) {
    // Network item click
    html.find('.ncm-network-dialog-item').click(async function() {
      const networkId = $(this).data('network-id');
      
      if (!networkId || !networkManager) {
        ui.notifications.error('Invalid network selection');
        return;
      }
      
      try {
        // Get the full network object
        const networks = await networkManager.getAvailableNetworks();
        const network = networks.find(n => n.id === networkId);
        
        if (!network) {
          ui.notifications.error('Network not found');
          return;
        }
        
        // Check if authentication is required
        const requiresAuth = network.security?.requiresAuth || network.requiresAuth;
        
        if (requiresAuth) {
          console.log(`${MODULE_ID} | ${networkId} requires authentication`);
          
          // FIX: Actually open the authentication dialog!
          const { NetworkAuthDialog } = await import('./NetworkAuthDialog.js');
          
          const authDialog = new NetworkAuthDialog(network, {
            actor: game.user.character,
            onSuccess: async (result) => {
              console.log(`${MODULE_ID} | Authentication successful, connecting...`);
              
              // Now connect to the network
              const connectResult = await networkManager.connectToNetwork(networkId);
              
              if (connectResult.success) {
                ui.notifications.info(`Connected to ${network.name}`);
                
                // Close the selector dialog
                html.closest('.dialog').find('.dialog-button.close').click();
                
                // Refresh any open apps
                Object.values(ui.windows).forEach(app => {
                  if (app.render && typeof app.render === 'function') {
                    app.render(false);
                  }
                });
              } else {
                ui.notifications.error(connectResult.error || 'Connection failed');
              }
            },
            onCancel: () => {
              console.log(`${MODULE_ID} | Authentication cancelled`);
              ui.notifications.info('Connection cancelled');
            }
          });
          
          authDialog.render(true);
          return;
        }
        
        // No authentication required, connect directly
        const result = await networkManager.connectToNetwork(networkId);
        
        if (result.success) {
          ui.notifications.info(`Connected to ${networkId}`);
          
          // Close dialog
          html.closest('.dialog').find('.dialog-button.close').click();
          
          // Refresh any open apps
          Object.values(ui.windows).forEach(app => {
            if (app.render && typeof app.render === 'function') {
              app.render(false);
            }
          });
        } else if (result.requiresAuth) {
          // This shouldn't happen (we check above), but handle it
          ui.notifications.warn(`${networkId} requires authentication`);
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
      html.closest('.dialog').find('.dialog-button.close').click();
      
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
        html.closest('.dialog').find('.dialog-button.close').click();
        
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
    
    // Check reliability
    if (typeof network.reliability === 'number') {
      return network.reliability;
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
    // Use custom icon if specified
    if (network.theme?.icon) {
      return network.theme.icon;
    }
    
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