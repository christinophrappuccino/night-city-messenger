/**
 * Spam Detection Service
 * File: scripts/services/SpamDetectionService.js
 * Module: cyberpunkred-messenger
 * Description: Detects and filters spam messages
 */

import { MODULE_ID } from '../utils/constants.js';
import { SettingsManager } from '../core/SettingsManager.js';

export class SpamDetectionService {
  constructor() {
    this.settingsManager = SettingsManager.getInstance();
    
    // Spam indicators
    this.spamKeywords = [
      'free eddies', 'click here', 'act now', 'limited time',
      'winner', 'congratulations', 'claim your prize',
      'hot singles', 'earn money fast', 'work from home',
      'nigerian prince', 'inheritance', 'bank account',
      'verify your account', 'suspended', 'urgent action required'
    ];
    
    this.spamPatterns = [
      /\$\$\$/g, // Multiple dollar signs
      /!!!+/g, // Multiple exclamation marks
      /FREE/gi, // FREE in caps
      /CLICK HERE/gi,
      /100% (FREE|GUARANTEED)/gi
    ];
    
    // Track sender frequency (simple rate limiting)
    this.sendHistory = new Map();
  }
  
  /**
   * Detect if message is spam
   * @param {Object} messageData - Message data
   * @returns {boolean}
   */
  detectSpam(messageData) {
    // Check if spam filter is enabled
    if (!this.settingsManager.get('spamFilterEnabled')) {
      return false;
    }
    
    let spamScore = 0;
    const threshold = 3; // Spam if score >= threshold
    
    // Check keywords
    const content = `${messageData.subject} ${messageData.content}`.toLowerCase();
    this.spamKeywords.forEach(keyword => {
      if (content.includes(keyword)) {
        spamScore += 1;
      }
    });
    
    // Check patterns
    const fullText = `${messageData.subject} ${messageData.content}`;
    this.spamPatterns.forEach(pattern => {
      if (pattern.test(fullText)) {
        spamScore += 1;
      }
    });
    
    // Check excessive caps
    const capsRatio = this._calculateCapsRatio(fullText);
    if (capsRatio > 0.5 && fullText.length > 20) {
      spamScore += 1;
    }
    
    // Check sender rate
    if (this._isRateLimited(messageData.from)) {
      spamScore += 2;
    }
    
    // Check suspicious domains
    if (this._hasSuspiciousDomain(messageData.from)) {
      spamScore += 1;
    }
    
    console.log(`${MODULE_ID} | Spam score for message: ${spamScore}/${threshold}`);
    
    return spamScore >= threshold;
  }
  
  /**
   * Mark message as spam
   * @param {string} messageId - Message ID
   * @param {Object} messageData - Message data for learning
   */
  learnSpam(messageId, messageData) {
    // Extract keywords from spam message
    // In a full implementation, this would update a spam database
    console.log(`${MODULE_ID} | Learning from spam message:`, messageId);
  }
  
  /**
   * Mark message as not spam
   * @param {string} messageId - Message ID
   * @param {Object} messageData - Message data for learning
   */
  learnHam(messageId, messageData) {
    // Remove keywords from spam database
    console.log(`${MODULE_ID} | Learning from ham message:`, messageId);
  }
  
  /**
   * Get spam statistics
   * @returns {Object}
   */
  getStatistics() {
    return {
      totalScanned: 0, // Would track in real implementation
      spamDetected: 0,
      falsePositives: 0,
      accuracy: 0
    };
  }
  
  // ========================================
  // Private Helper Methods
  // ========================================
  
  /**
   * Calculate ratio of capital letters
   * @private
   */
  _calculateCapsRatio(text) {
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length === 0) return 0;
    
    const caps = text.replace(/[^A-Z]/g, '');
    return caps.length / letters.length;
  }
  
  /**
   * Check if sender is rate limited
   * @private
   */
  _isRateLimited(sender) {
    const now = Date.now();
    const history = this.sendHistory.get(sender) || [];
    
    // Remove old entries (older than 1 hour)
    const recent = history.filter(time => now - time < 3600000);
    
    // Update history
    this.sendHistory.set(sender, recent);
    
    // Rate limit: max 10 messages per hour
    return recent.length >= 10;
  }
  
  /**
   * Track message send
   * @param {string} sender - Sender email
   */
  trackSend(sender) {
    const history = this.sendHistory.get(sender) || [];
    history.push(Date.now());
    this.sendHistory.set(sender, history);
  }
  
  /**
   * Check for suspicious domains
   * @private
   */
  _hasSuspiciousDomain(email) {
    const suspiciousDomains = [
      'totally-legit',
      'scam.net',
      'spam.com',
      'phishing.net',
      'fake-bank'
    ];
    
    const domain = email.split('@')[1]?.toLowerCase() || '';
    
    return suspiciousDomains.some(suspicious => domain.includes(suspicious));
  }
  
  /**
   * Clear send history
   */
  clearHistory() {
    this.sendHistory.clear();
  }
}