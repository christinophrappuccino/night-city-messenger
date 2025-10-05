/**
 * Statistics Panel Component
 * File: scripts/ui/components/AdminPanel/StatisticsPanel.js
 * Module: cyberpunkred-messenger
 * Description: Display system-wide statistics and charts
 */

import { MODULE_ID } from '../../../utils/constants.js';

export class StatisticsPanel {
  constructor(parent) {
    this.parent = parent;
  }
  
  /**
   * Get statistics data
   * @returns {Object}
   */
  async getStatistics() {
    const stats = {
      overview: await this._getOverviewStats(),
      trends: await this._getTrendStats(),
      topUsers: await this._getTopUsers(),
      spamReport: await this._getSpamReport()
    };
    
    return stats;
  }
  
  /**
   * Generate statistics report
   * @returns {string} HTML report
   */
  async generateReport() {
    const stats = await this.getStatistics();
    
    return `
      <div class="ncm-stats-report">
        <h2>Night City Messenger - Statistics Report</h2>
        <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
        
        <h3>Overview</h3>
        <ul>
          <li>Total Messages: ${stats.overview.total}</li>
          <li>Unread Messages: ${stats.overview.unread}</li>
          <li>Saved Messages: ${stats.overview.saved}</li>
          <li>Spam Messages: ${stats.overview.spam}</li>
        </ul>
        
        <h3>Top Users</h3>
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Total Messages</th>
              <th>Unread</th>
            </tr>
          </thead>
          <tbody>
            ${stats.topUsers.map(u => `
              <tr>
                <td>${u.name}</td>
                <td>${u.total}</td>
                <td>${u.unread}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        
        <h3>Spam Report</h3>
        <p>Spam Rate: ${stats.spamReport.rate}%</p>
        <p>Total Spam: ${stats.spamReport.total}</p>
      </div>
    `;
  }
  
  /**
   * Export statistics as CSV
   */
  async exportCSV() {
    const stats = await this.getStatistics();
    
    // Build CSV
    let csv = 'User,Character,Total Messages,Unread,Saved,Spam\n';
    
    stats.topUsers.forEach(user => {
      csv += `"${user.name}","${user.character}",${user.total},${user.unread},${user.saved},${user.spam}\n`;
    });
    
    // Create download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `night-city-stats-${Date.now()}.csv`;
    a.click();
    
    URL.revokeObjectURL(url);
    
    ui.notifications.info('Statistics exported as CSV');
  }
  
  /**
   * Activate event listeners
   */
  activateListeners(html) {
    // Export CSV button
    html.find('.ncm-stats__export-csv-btn').on('click', () => {
      this.exportCSV();
    });
    
    // Generate report button
    html.find('.ncm-stats__report-btn').on('click', async () => {
      const report = await this.generateReport();
      
      new Dialog({
        title: 'Statistics Report',
        content: report,
        buttons: {
          close: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Close'
          }
        }
      }, {
        classes: ['dialog', 'ncm-dialog'],
        width: 700,
        height: 600
      }).render(true);
    });
  }
  
  // ========================================
  // Private Helper Methods
  // ========================================
  
  /**
   * Get overview statistics
   * @private
   */
  async _getOverviewStats() {
    const journals = game.journal.filter(j => j.getFlag(MODULE_ID, 'isInbox'));
    
    let total = 0;
    let unread = 0;
    let saved = 0;
    let spam = 0;
    
    journals.forEach(journal => {
      journal.pages.forEach(page => {
        total++;
        
        const status = page.getFlag(MODULE_ID, 'status') || {};
        if (!status.read) unread++;
        if (status.saved) saved++;
        if (status.spam) spam++;
      });
    });
    
    return { total, unread, saved, spam };
  }
  
  /**
   * Get trend statistics (last 7 days)
   * @private
   */
  async _getTrendStats() {
    // In a full implementation, this would track messages over time
    return {
      daily: [12, 15, 8, 22, 18, 25, 30], // Messages per day
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    };
  }
  
  /**
   * Get top users by message count
   * @private
   */
  async _getTopUsers() {
    const journals = game.journal.filter(j => j.getFlag(MODULE_ID, 'isInbox'));
    const users = [];
    
    journals.forEach(journal => {
      const userId = journal.getFlag(MODULE_ID, 'userId');
      const user = game.users.get(userId);
      
      if (!user) return;
      
      let unread = 0;
      let saved = 0;
      let spam = 0;
      
      journal.pages.forEach(page => {
        const status = page.getFlag(MODULE_ID, 'status') || {};
        if (!status.read) unread++;
        if (status.saved) saved++;
        if (status.spam) spam++;
      });
      
      users.push({
        id: userId,
        name: user.name,
        character: user.character?.name || 'No Character',
        total: journal.pages.size,
        unread,
        saved,
        spam
      });
    });
    
    return users.sort((a, b) => b.total - a.total);
  }
  
  /**
   * Get spam report
   * @private
   */
  async _getSpamReport() {
    const stats = await this._getOverviewStats();
    
    const rate = stats.total > 0 
      ? ((stats.spam / stats.total) * 100).toFixed(1)
      : 0;
    
    return {
      total: stats.spam,
      rate: rate
    };
  }
  
  /**
   * Cleanup
   */
  destroy() {
    // Cleanup if needed
  }
}