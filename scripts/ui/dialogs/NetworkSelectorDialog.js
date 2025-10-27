/**
 * Network Selector Dialog
 * File: scripts/ui/dialogs/NetworkSelectorDialog.js
 * Module: cyberpunkred-messenger
 * 
 * Opens network selector as a POPUP DIALOG instead of inline expansion
 */

import { MODULE_ID } from '../../utils/constants.js';

export class NetworkSelectorDialog extends Dialog {
  constructor(options = {}) {
    const networkManager = game.nightcity?.networkManager;
    const currentStatus = networkManager?.getNetworkStatus() || {};
    
    // Get available networks
    const networks = networkManager?.getAvailableNetworks() || [];
    
    // Build network list HTML
    const networkListHTML = networks.map(network => {
      const isConnected = network.id === currentStatus.networkId;
      const signalBars = game.nightcity?.NetworkUtils?.generateSignalBars(network.signalStrength || 0) || '';
      
      return `
        <div class="ncm-network-dialog-item ${isConnected ? 'connected' : ''}" 
             data-network-id="${network.id}">
          <div class="network-item-icon" style="color: ${network.color};">
            <i class="fas ${network.icon}"></i>
          </div>
          <div class="network-item-details">
            <div class="network-item-name">
              ${network.displayName}
              ${isConnected ? '<span class="connected-badge">✓ CONNECTED</span>' : ''}
            </div>
            <div class="network-item-type">${network.type}</div>
            ${network.description ? `<div class="network-item-desc">${network.description}</div>` : ''}
            ${network.requiresAuth ? `<div class="network-item-security">🔒 ${network.securityLevel}</div>` : ''}
          </div>
          <div class="network-item-signal">
            ${signalBars}
            <span>${network.signalStrength}%</span>
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
                `<span class="status-connected">Connected • ${currentStatus.signalStrength}% Signal</span>` : 
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
    
    super({
      title: "Network Selector",
      content: content,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: "Close"
        }
      },
      default: "close",
      render: html => {
        // Network item click
        html.find('.ncm-network-dialog-item').click(async function() {
          const networkId = $(this).data('network-id');
          if (!networkId) return;
          
          const nm = game.nightcity?.networkManager;
          if (!nm) return;
          
          try {
            await nm.connectToNetwork(networkId);
            ui.notifications.info(`Connected to ${networkId}`);
            
            // Close dialog
            html.closest('.dialog').find('.dialog-button').click();
            
            // Refresh any open apps
            Object.values(ui.windows).forEach(app => {
              if (app.render && typeof app.render === 'function') {
                app.render(false);
              }
            });
          } catch (error) {
            ui.notifications.error(`Failed to connect: ${error.message}`);
          }
        });
        
        // Disconnect button
        html.find('[data-action="disconnect"]').click(async function() {
          const nm = game.nightcity?.networkManager;
          if (!nm) return;
          
          await nm.disconnect();
          ui.notifications.info('Disconnected from network');
          html.closest('.dialog').find('.dialog-button').click();
        });
        
        // Scan button
        html.find('[data-action="scan"]').click(async function() {
          const nm = game.nightcity?.networkManager;
          if (!nm) return;
          
          ui.notifications.info('Scanning for networks...');
          await nm.scanNetworks();
          
          // Reopen dialog with new results
          html.closest('.dialog').find('.dialog-button').click();
          new NetworkSelectorDialog().render(true);
        });
      }
    }, {
      classes: ['dialog', 'ncm-dialog', 'ncm-network-selector-dialog'],
      width: 500,
      height: 'auto'
    });
  }
}