/**
 * NetworkStorage
 * File: scripts/core/NetworkStorage.js
 * Module: cyberpunkred-messenger
 * Description: Handles CRUD operations for custom networks
 */

import { MODULE_ID } from '../utils/constants.js';

export class NetworkStorage {
  
  /**
   * Create a new network
   * @param {Object} networkData - Network configuration
   * @returns {Promise<Object>} Created network
   */
  static async createNetwork(networkData) {
    const networks = await this.getAllNetworks();
    
    // Generate ID if not provided
    if (!networkData.id) {
      networkData.id = foundry.utils.randomID();
    }
    
    // Add metadata
    networkData.createdBy = game.user.id;
    networkData.createdAt = new Date().toISOString();
    
    // Validate
    if (!this.validateNetwork(networkData)) {
      throw new Error('Invalid network data');
    }
    
    // Add to list
    networks.push(networkData);
    await game.settings.set(MODULE_ID, 'customNetworks', networks);
    
    console.log(`${MODULE_ID} | Created network: ${networkData.name} (${networkData.id})`);
    
    // Emit event
    Hooks.call('ncm.networkCreated', networkData);
    
    return networkData;
  }
  
  /**
   * Update existing network
   * @param {string} networkId - Network ID
   * @param {Object} updates - Properties to update
   * @returns {Promise<Object>} Updated network
   */
  static async updateNetwork(networkId, updates) {
    const networks = await this.getAllNetworks();
    const index = networks.findIndex(n => n.id === networkId);
    
    if (index === -1) {
      throw new Error(`Network not found: ${networkId}`);
    }
    
    // Merge updates
    networks[index] = foundry.utils.mergeObject(networks[index], updates);
    
    await game.settings.set(MODULE_ID, 'customNetworks', networks);
    
    console.log(`${MODULE_ID} | Updated network: ${networkId}`);
    
    // Emit event
    Hooks.call('ncm.networkUpdated', networks[index]);
    
    return networks[index];
  }
  
  /**
   * Delete network
   * @param {string} networkId - Network ID to delete
   */
  static async deleteNetwork(networkId) {
    const networks = await this.getAllNetworks();
    const filtered = networks.filter(n => n.id !== networkId);
    
    if (filtered.length === networks.length) {
      throw new Error(`Network not found: ${networkId}`);
    }
    
    await game.settings.set(MODULE_ID, 'customNetworks', filtered);
    
    console.log(`${MODULE_ID} | Deleted network: ${networkId}`);
    
    // Emit event
    Hooks.call('ncm.networkDeleted', networkId);
  }
  
  /**
   * Get all networks
   * @returns {Promise<Array>} All networks
   */
  static async getAllNetworks() {
    return await game.settings.get(MODULE_ID, 'customNetworks') || [];
  }
  
  /**
   * Get single network by ID
   * @param {string} networkId - Network ID
   * @returns {Promise<Object|null>} Network or null
   */
  static async getNetwork(networkId) {
    const networks = await this.getAllNetworks();
    return networks.find(n => n.id === networkId) || null;
  }
  
  /**
   * Validate network data structure
   * @param {Object} network - Network to validate
   * @returns {boolean} Is valid
   */
  static validateNetwork(network) {
    // Required fields
    if (!network.id || typeof network.id !== 'string') {
      console.error(`${MODULE_ID} | Invalid network: missing or invalid id`);
      return false;
    }
    
    if (!network.name || typeof network.name !== 'string') {
      console.error(`${MODULE_ID} | Invalid network: missing or invalid name`);
      return false;
    }
    
    if (!network.type || typeof network.type !== 'string') {
      console.error(`${MODULE_ID} | Invalid network: missing or invalid type`);
      return false;
    }
    
    if (!network.security || typeof network.security !== 'object') {
      console.error(`${MODULE_ID} | Invalid network: missing security config`);
      return false;
    }
    
    if (!network.effects || typeof network.effects !== 'object') {
      console.error(`${MODULE_ID} | Invalid network: missing effects config`);
      return false;
    }
    
    if (!network.theme || typeof network.theme !== 'object') {
      console.error(`${MODULE_ID} | Invalid network: missing theme config`);
      return false;
    }
    
    // Validate numeric values
    if (typeof network.signalStrength !== 'number' || network.signalStrength < 0 || network.signalStrength > 100) {
      console.error(`${MODULE_ID} | Invalid network: signalStrength must be 0-100`);
      return false;
    }
    
    if (typeof network.reliability !== 'number' || network.reliability < 0 || network.reliability > 100) {
      console.error(`${MODULE_ID} | Invalid network: reliability must be 0-100`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Set network password
   * @param {string} networkId - Network ID
   * @param {string} password - Password to set
   * @returns {Promise<Object>} Updated network
   */
  static async setNetworkPassword(networkId, password) {
    const network = await this.getNetwork(networkId);
    if (!network) {
      throw new Error(`Network not found: ${networkId}`);
    }
    
    // Hash password (using simple hash for demo)
    const passwordHash = this._hashPassword(password);
    
    return await this.updateNetwork(networkId, {
      'security.password': passwordHash,
      'security.requiresAuth': true
    });
  }
  
  /**
   * Hash password (matches NetworkManager implementation)
   * @private
   */
  static _hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
  
  /**
   * Export networks to JSON
   * @returns {string} JSON string of all networks
   */
  static async exportNetworks() {
    const networks = await this.getAllNetworks();
    return JSON.stringify(networks, null, 2);
  }
  
  /**
   * Import networks from JSON
   * @param {string} jsonData - JSON string
   * @param {boolean} merge - Merge with existing or replace
   * @returns {Promise<number>} Number of imported networks
   */
  static async importNetworks(jsonData, merge = false) {
    try {
      const importedNetworks = JSON.parse(jsonData);
      
      if (!Array.isArray(importedNetworks)) {
        throw new Error('Invalid import data: expected array');
      }
      
      // Validate all networks
      for (const network of importedNetworks) {
        if (!this.validateNetwork(network)) {
          throw new Error(`Invalid network in import: ${network.name || 'unknown'}`);
        }
      }
      
      let networks;
      if (merge) {
        const existing = await this.getAllNetworks();
        // Merge, replacing any with matching IDs
        const existingIds = existing.map(n => n.id);
        const newNetworks = importedNetworks.filter(n => !existingIds.includes(n.id));
        networks = [...existing, ...newNetworks];
      } else {
        networks = importedNetworks;
      }
      
      await game.settings.set(MODULE_ID, 'customNetworks', networks);
      
      console.log(`${MODULE_ID} | Imported ${importedNetworks.length} networks (merge: ${merge})`);
      
      return importedNetworks.length;
      
    } catch (error) {
      console.error(`${MODULE_ID} | Import failed:`, error);
      throw error;
    }
  }
}