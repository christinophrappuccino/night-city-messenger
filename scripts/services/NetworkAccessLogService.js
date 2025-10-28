/**
 * Network Access Log Service
 * File: scripts/services/NetworkAccessLogService.js
 * Module: cyberpunkred-messenger
 * Description: Tracks and manages network access logs for security and debugging
 */

import { MODULE_ID } from '../utils/constants.js';

export class NetworkAccessLogService {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000; // Keep last 1000 logs
    this.retentionDays = {
      regular: 7,
      security: 30
    };
    
    this._initialized = false;
  }
  
  async initialize() {
    if (this._initialized) return;
    
    console.log(`${MODULE_ID} | Initializing Network Access Log Service...`);
    
    // Load logs from settings
    await this._loadLogs();
    
    // Setup auto-cleanup
    this._setupCleanup();
    
    // Listen for network events
    this._registerEventListeners();
    
    this._initialized = true;
    console.log(`${MODULE_ID} | ✓ Network Access Log Service initialized`);
  }
  
  /* -------------------------------------------- */
  /*  Logging Methods                             */
  /* -------------------------------------------- */
  
  /**
   * Log a network connection attempt
   * @param {Object} data - Connection data
   */
  async logConnection(data) {
    const entry = {
      id: foundry.utils.randomID(),
      timestamp: Date.now(),
      type: 'connection',
      severity: 'info',
      actor: data.actor,
      network: data.network,
      success: data.success,
      signalStrength: data.signalStrength,
      scene: game.scenes.active?.id,
      details: data.details || {}
    };
    
    await this._addLog(entry);
  }
  
  /**
   * Log an authentication attempt
   * @param {Object} data - Auth data
   */
  async logAuthentication(data) {
    const entry = {
      id: foundry.utils.randomID(),
      timestamp: Date.now(),
      type: 'authentication',
      severity: data.success ? 'info' : 'warning',
      actor: data.actor,
      network: data.network,
      method: data.method, // 'password' | 'breach' | 'bypass'
      success: data.success,
      attempts: data.attempts,
      scene: game.scenes.active?.id,
      details: data.details || {}
    };
    
    await this._addLog(entry);
    
    // Post to chat for failed auth attempts
    if (!data.success && data.method === 'password') {
      await game.nightcity.chatIntegration.postNetworkEvent({
        type: 'auth-failed',
        actor: data.actor,
        network: data.network,
        attempts: data.attempts
      });
    }
  }
  
  /**
   * Log a breach attempt
   * @param {Object} data - Breach data
   */
  async logBreach(data) {
    const entry = {
      id: foundry.utils.randomID(),
      timestamp: Date.now(),
      type: 'breach',
      severity: data.success ? 'warning' : 'critical',
      actor: data.actor,
      network: data.network,
      skill: data.skill,
      roll: data.roll,
      dc: data.dc,
      success: data.success,
      iceDamage: data.iceDamage,
      netwatchAlert: data.netwatchAlert,
      scene: game.scenes.active?.id,
      details: data.details || {}
    };
    
    await this._addLog(entry);
    
    // Always post breach attempts to chat
    await game.nightcity.chatIntegration.postNetworkEvent({
      type: 'breach-attempt',
      actor: data.actor,
      network: data.network,
      success: data.success,
      damage: data.iceDamage
    });
  }
  
  /**
   * Log a message send
   * @param {Object} data - Message data
   */
  async logMessage(data) {
    const entry = {
      id: foundry.utils.randomID(),
      timestamp: Date.now(),
      type: 'message',
      severity: 'info',
      actor: data.from,
      network: data.network,
      to: data.to,
      anonymous: data.anonymous,
      encrypted: data.encrypted,
      proxy: data.proxy,
      success: data.success,
      scene: game.scenes.active?.id,
      details: data.details || {}
    };
    
    await this._addLog(entry);
  }
  
  /**
   * Log a network event
   * @param {Object} data - Event data
   */
  async logEvent(data) {
    const entry = {
      id: foundry.utils.randomID(),
      timestamp: Date.now(),
      type: 'event',
      severity: 'warning',
      network: data.network,
      eventType: data.eventType,
      eventName: data.eventName,
      triggered: data.triggered,
      scene: game.scenes.active?.id,
      details: data.details || {}
    };
    
    await this._addLog(entry);
  }
  
  /**
   * Log a security incident
   * @param {Object} data - Incident data
   */
  async logSecurityIncident(data) {
    const entry = {
      id: foundry.utils.randomID(),
      timestamp: Date.now(),
      type: 'security',
      severity: 'critical',
      actor: data.actor,
      network: data.network,
      incident: data.incident,
      scene: game.scenes.active?.id,
      details: data.details || {}
    };
    
    await this._addLog(entry);
    
    // Post security incidents to chat
    await game.nightcity.chatIntegration.postNetworkEvent({
      type: 'security-incident',
      actor: data.actor,
      network: data.network,
      incident: data.incident
    });
  }
  
  /**
   * Log a NetWatch alert
   * @param {Object} data - Alert data
   */
  async logNetwatchAlert(data) {
    const entry = {
      id: foundry.utils.randomID(),
      timestamp: Date.now(),
      type: 'netwatch',
      severity: 'critical',
      actor: data.actor,
      network: data.network,
      reason: data.reason,
      scene: game.scenes.active?.id,
      details: data.details || {}
    };
    
    await this._addLog(entry);
    
    // Whisper to GM
    if (game.user.isGM) {
      await ChatMessage.create({
        content: `<div class="ncm-netwatch-alert">
          <h3>⚠️ NETWATCH ALERT</h3>
          <p><strong>Network:</strong> ${data.network}</p>
          <p><strong>Actor:</strong> ${data.actor?.name || 'Unknown'}</p>
          <p><strong>Reason:</strong> ${data.reason}</p>
        </div>`,
        whisper: [game.user.id],
        flags: {
          [MODULE_ID]: {
            type: 'netwatch-alert'
          }
        }
      });
    }
  }
  
  /* -------------------------------------------- */
  /*  Query Methods                               */
  /* -------------------------------------------- */
  
  /**
   * Get all logs
   * @param {Object} options - Filter options
   * @returns {Array} Filtered logs
   */
  async getLogs(options = {}) {
    let logs = [...this.logs];
    
    // Filter by type
    if (options.type) {
      logs = logs.filter(log => log.type === options.type);
    }
    
    // Filter by actor
    if (options.actorId) {
      logs = logs.filter(log => log.actor?.id === options.actorId);
    }
    
    // Filter by network
    if (options.network) {
      logs = logs.filter(log => log.network === options.network);
    }
    
    // Filter by severity
    if (options.severity) {
      logs = logs.filter(log => log.severity === options.severity);
    }
    
    // Filter by date range
    if (options.startDate) {
      logs = logs.filter(log => log.timestamp >= options.startDate);
    }
    
    if (options.endDate) {
      logs = logs.filter(log => log.timestamp <= options.endDate);
    }
    
    // Filter by scene
    if (options.sceneId) {
      logs = logs.filter(log => log.scene === options.sceneId);
    }
    
    // Sort (newest first by default)
    logs.sort((a, b) => b.timestamp - a.timestamp);
    
    // Limit
    if (options.limit) {
      logs = logs.slice(0, options.limit);
    }
    
    return logs;
  }
  
  /**
   * Get logs for a specific actor
   * @param {string} actorId - Actor ID
   * @param {Object} options - Additional filter options
   * @returns {Array} Actor logs
   */
  async getActorLogs(actorId, options = {}) {
    return this.getLogs({ ...options, actorId });
  }
  
  /**
   * Get logs for a specific network
   * @param {string} networkId - Network ID
   * @param {Object} options - Additional filter options
   * @returns {Array} Network logs
   */
  async getNetworkLogs(networkId, options = {}) {
    return this.getLogs({ ...options, network: networkId });
  }
  
  /**
   * Get security logs
   * @param {Object} options - Filter options
   * @returns {Array} Security logs
   */
  async getSecurityLogs(options = {}) {
    const types = ['breach', 'security', 'netwatch'];
    const logs = await this.getLogs(options);
    return logs.filter(log => types.includes(log.type));
  }
  
  /**
   * Get recent activity
   * @param {number} minutes - Time range in minutes
   * @returns {Array} Recent logs
   */
  async getRecentActivity(minutes = 60) {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.getLogs({ startDate: cutoff });
  }
  
  /**
   * Get log statistics
   * @returns {Object} Statistics
   */
  async getStatistics() {
    const logs = this.logs;
    
    // Count by type
    const byType = {};
    const bySeverity = {};
    const byNetwork = {};
    
    for (const log of logs) {
      byType[log.type] = (byType[log.type] || 0) + 1;
      bySeverity[log.severity] = (bySeverity[log.severity] || 0) + 1;
      if (log.network) {
        byNetwork[log.network] = (byNetwork[log.network] || 0) + 1;
      }
    }
    
    // Recent activity
    const last24h = await this.getRecentActivity(24 * 60);
    const lastHour = await this.getRecentActivity(60);
    
    // Security stats
    const securityLogs = await this.getSecurityLogs();
    const breaches = securityLogs.filter(l => l.type === 'breach');
    const successfulBreaches = breaches.filter(l => l.success);
    const netwatchAlerts = securityLogs.filter(l => l.type === 'netwatch');
    
    return {
      total: logs.length,
      byType,
      bySeverity,
      byNetwork,
      recent: {
        last24h: last24h.length,
        lastHour: lastHour.length
      },
      security: {
        total: securityLogs.length,
        breaches: breaches.length,
        successfulBreaches: successfulBreaches.length,
        netwatchAlerts: netwatchAlerts.length
      }
    };
  }
  
  /* -------------------------------------------- */
  /*  Management Methods                          */
  /* -------------------------------------------- */
  
  /**
   * Clear all logs
   */
  async clearLogs() {
    this.logs = [];
    await this._saveLogs();
    console.log(`${MODULE_ID} | Logs cleared`);
  }
  
  /**
   * Clear old logs based on retention policy
   */
  async cleanupLogs() {
    const now = Date.now();
    const retentionMs = {
      regular: this.retentionDays.regular * 24 * 60 * 60 * 1000,
      security: this.retentionDays.security * 24 * 60 * 60 * 1000
    };
    
    const before = this.logs.length;
    
    this.logs = this.logs.filter(log => {
      const age = now - log.timestamp;
      const isSecurityLog = ['breach', 'security', 'netwatch'].includes(log.type);
      const retention = isSecurityLog ? retentionMs.security : retentionMs.regular;
      
      return age < retention;
    });
    
    // Also enforce max logs
    if (this.logs.length > this.maxLogs) {
      // Keep newest logs
      this.logs.sort((a, b) => b.timestamp - a.timestamp);
      this.logs = this.logs.slice(0, this.maxLogs);
    }
    
    const after = this.logs.length;
    const removed = before - after;
    
    if (removed > 0) {
      await this._saveLogs();
      console.log(`${MODULE_ID} | Cleaned up ${removed} old log entries`);
    }
  }
  
  /**
   * Export logs to JSON
   * @param {Object} options - Filter options
   * @returns {string} JSON string
   */
  async exportLogs(options = {}) {
    const logs = await this.getLogs(options);
    
    const exportData = {
      version: '1.0',
      module: MODULE_ID,
      exportedAt: new Date().toISOString(),
      exportedBy: game.user.name,
      count: logs.length,
      logs: logs
    };
    
    return JSON.stringify(exportData, null, 2);
  }
  
  /* -------------------------------------------- */
  /*  Private Methods                             */
  /* -------------------------------------------- */
  
  async _addLog(entry) {
    this.logs.push(entry);
    
    // Enforce max logs immediately
    if (this.logs.length > this.maxLogs) {
      this.logs.sort((a, b) => b.timestamp - a.timestamp);
      this.logs = this.logs.slice(0, this.maxLogs);
    }
    
    // Save periodically (every 10 entries)
    if (this.logs.length % 10 === 0) {
      await this._saveLogs();
    }
    
    // Emit event
    Hooks.callAll(`${MODULE_ID}.logAdded`, entry);
  }
  
  async _loadLogs() {
    try {
      const data = game.settings.get(MODULE_ID, 'networkLogs') || [];
      this.logs = data;
      console.log(`${MODULE_ID} | Loaded ${this.logs.length} log entries`);
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading logs:`, error);
      this.logs = [];
    }
  }
  
  async _saveLogs() {
    try {
      await game.settings.set(MODULE_ID, 'networkLogs', this.logs);
    } catch (error) {
      console.error(`${MODULE_ID} | Error saving logs:`, error);
    }
  }
  
  _setupCleanup() {
    // Clean up old logs daily
    setInterval(() => {
      this.cleanupLogs();
    }, 24 * 60 * 60 * 1000); // 24 hours
    
    // Also clean on startup
    this.cleanupLogs();
  }
  
  _registerEventListeners() {
    // Listen for network connection events
    Hooks.on(`${MODULE_ID}.networkConnected`, async (data) => {
      await this.logConnection({
        actor: data.actor,
        network: data.network,
        success: true,
        signalStrength: data.signalStrength
      });
    });
    
    // Listen for authentication events
    Hooks.on(`${MODULE_ID}.authenticationAttempt`, async (data) => {
      await this.logAuthentication(data);
    });
    
    // Listen for breach attempts
    Hooks.on(`${MODULE_ID}.breachAttempt`, async (data) => {
      await this.logBreach(data);
    });
    
    // Listen for message sends
    Hooks.on(`${MODULE_ID}.messageSent`, async (data) => {
      await this.logMessage(data);
    });
    
    // Listen for network events
    Hooks.on(`${MODULE_ID}.networkEvent`, async (data) => {
      await this.logEvent(data);
    });
    
    // Listen for security incidents
    Hooks.on(`${MODULE_ID}.securityIncident`, async (data) => {
      await this.logSecurityIncident(data);
    });
    
    // Listen for NetWatch alerts
    Hooks.on(`${MODULE_ID}.netwatchAlert`, async (data) => {
      await this.logNetwatchAlert(data);
    });
  }
}

// Register setting for log storage
Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'networkLogs', {
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });
  
  game.settings.register(MODULE_ID, 'logRetentionDays', {
    name: 'Log Retention (Days)',
    hint: 'How many days to keep regular network logs (security logs kept longer)',
    scope: 'world',
    config: true,
    type: Number,
    default: 7,
    range: {
      min: 1,
      max: 90,
      step: 1
    }
  });
  
  game.settings.register(MODULE_ID, 'securityLogRetentionDays', {
    name: 'Security Log Retention (Days)',
    hint: 'How many days to keep security-related logs (breaches, alerts)',
    scope: 'world',
    config: true,
    type: Number,
    default: 30,
    range: {
      min: 1,
      max: 365,
      step: 1
    }
  });
});