/**
 * Encryption System
 * File: scripts/ui/components/ItemInbox/EncryptionSystem.js
 * Module: cyberpunkred-messenger
 * Description: Handles encryption logic for data shards
 */

import { MODULE_ID } from '../../../utils/constants.js';

export class EncryptionSystem {
  constructor(parent) {
    this.parent = parent;
    this.item = parent.item;
  }
  
  /**
   * Check if globally decrypted
   * @returns {boolean}
   */
  isGloballyDecrypted() {
    const encrypted = this.item.getFlag(MODULE_ID, 'encrypted');
    return !encrypted;
  }
  
  /**
   * Check if all messages are decrypted
   * @param {Array} messages - Messages array
   * @returns {boolean}
   */
  isFullyDecrypted(messages) {
    if (this.isGloballyDecrypted()) return true;
    
    // Check if any encrypted messages remain
    return !messages.some(m => m.isEncrypted && !m.isDecrypted);
  }
  
  /**
   * Get encryption status
   * @param {Array} messages - Messages array
   * @returns {string} 'ENCRYPTED' or 'DECRYPTED'
   */
  getEncryptionStatus(messages) {
    if (this.isFullyDecrypted(messages)) {
      return 'DECRYPTED';
    }
    return 'ENCRYPTED';
  }
  
  /**
   * Get encryption type display
   * @returns {string}
   */
  getEncryptionTypeDisplay() {
    const type = this.item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
    const dc = this.item.getFlag(MODULE_ID, 'encryptionDC') || 15;
    
    const typeNames = {
      'ICE': 'Standard ICE',
      'BLACK_ICE': 'BLACK ICE',
      'RED_ICE': 'RED ICE',
      'CUSTOM': 'Custom Encryption'
    };
    
    return `${typeNames[type] || type} (DC ${dc})`;
  }
  
  /**
   * Get encryption color
   * @returns {string}
   */
  getEncryptionColor() {
    const type = this.item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
    
    const colors = {
      'ICE': '#19f3f7',
      'BLACK_ICE': '#000000',
      'RED_ICE': '#ff0000',
      'CUSTOM': '#F65261'
    };
    
    return colors[type] || '#19f3f7';
  }
  
  /**
   * Encrypt message
   * @param {string} messageId - Message ID
   * @returns {Promise<boolean>}
   */
  async encryptMessage(messageId) {
    try {
      const messagesData = this.item.getFlag(MODULE_ID, 'messages') || {};
      
      if (!messagesData[messageId]) {
        return false;
      }
      
      messagesData[messageId].encrypted = true;
      
      await this.item.setFlag(MODULE_ID, 'messages', messagesData);
      
      // Clear local decryption state
      const key = `${MODULE_ID}-decrypted-${this.item.id}-${messageId}`;
      localStorage.removeItem(key);
      
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Error encrypting message:`, error);
      return false;
    }
  }
  
  /**
   * Decrypt message locally
   * @param {string} messageId - Message ID
   */
  decryptMessageLocally(messageId) {
    const key = `${MODULE_ID}-decrypted-${this.item.id}-${messageId}`;
    localStorage.setItem(key, 'true');
  }
  
  /**
   * Check if message is encrypted
   * @param {string} messageId - Message ID
   * @returns {boolean}
   */
  isMessageEncrypted(messageId) {
    const globalEncrypted = this.item.getFlag(MODULE_ID, 'encrypted');
    const messagesData = this.item.getFlag(MODULE_ID, 'messages') || {};
    const msgData = messagesData[messageId];
    
    if (!msgData) return false;
    
    return msgData.encrypted !== undefined 
      ? msgData.encrypted 
      : globalEncrypted;
  }
  
  /**
   * Get encrypted message display
   * @returns {string}
   */
  getEncryptedDisplay() {
    return `
      <div class="ncm-encrypted-overlay">
        <i class="fas fa-lock fa-3x"></i>
        <p>MESSAGE ENCRYPTED</p>
        <p class="ncm-encrypted-hint">Attempt decryption to view contents</p>
      </div>
    `;
  }
  
  /**
   * Cleanup
   */
  destroy() {
    // Cleanup if needed
  }
}