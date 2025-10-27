/**
 * Network Authentication Dialog
 * File: scripts/ui/dialogs/NetworkAuthDialog.js
 * Module: cyberpunkred-messenger
 * Description: Dialog for authenticating to secured networks with password or breach attempts
 */

export class NetworkAuthDialog extends Dialog {
  constructor(network, options = {}) {
    const dialogData = {
      title: `Network Authentication - ${network.displayName || network.name}`,
      content: '',
      buttons: {},
      default: 'connect',
      close: () => options.onCancel?.()
    };
    
    super(dialogData, options);
    
    /**
     * @property {Object} network - The network to authenticate to
     */
    this.network = network;
    
    /**
     * @property {Function} onSuccess - Callback for successful authentication
     */
    this.onSuccess = options.onSuccess;
    
    /**
     * @property {Function} onCancel - Callback for cancelled authentication
     */
    this.onCancel = options.onCancel;
    
    /**
     * @property {Actor} actor - Actor attempting authentication
     */
    this.actor = options.actor || game.user.character;
    
    /**
     * @property {number} attempts - Number of failed attempts
     */
    this.attempts = 0;
    
    /**
     * @property {number} maxAttempts - Maximum allowed attempts before lockout
     */
    this.maxAttempts = 3;
    
    // Check for lockout
    this._checkLockout();
  }

  /**
   * @override
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['ncm-network-auth-dialog', 'dialog'],
      template: 'modules/cyberpunkred-messenger/templates/dialogs/network-auth.hbs',
      width: 420,
      height: 'auto'
    });
  }

  /**
   * Get data for template rendering
   * @override
   */
  async getData() {
    const data = await super.getData();
    const networkManager = game.nightcity?.networkManager;
    
    // Check if user can attempt breach
    const canBreach = this._canAttemptBreach();
    const breachDV = this._getBreachDV();
    
    // Get lockout info
    const lockoutInfo = this._getLockoutInfo();
    
    return {
      ...data,
      network: {
        id: this.network.id,
        name: this.network.displayName || this.network.name,
        description: this.network.description || '',
        type: this.network.type,
        icon: game.nightcity.NetworkUtils.getNetworkTypeIcon(this.network.type),
        color: this.network.color || '#F65261',
        securityLevel: this.network.security?.level || 'NONE',
        securityDescription: this._getSecurityDescription(this.network.security?.level),
        requiresAuth: this.network.requiresAuth,
        isTraced: this.network.traced || false,
        isMonitored: this.network.monitored || false
      },
      
      // Actor info
      actor: this.actor ? {
        name: this.actor.name,
        id: this.actor.id,
        hasInterface: this._hasSkill('interface'),
        hasElectronics: this._hasSkill('electronics'),
        hasBasicTech: this._hasSkill('basic_tech')
      } : null,
      
      // Breach info
      canBreach: canBreach,
      breachDV: breachDV,
      breachSkill: this._getBestBreachSkill(),
      
      // Attempt tracking
      attempts: this.attempts,
      maxAttempts: this.maxAttempts,
      attemptsRemaining: this.maxAttempts - this.attempts,
      isLocked: lockoutInfo.isLocked,
      lockoutTime: lockoutInfo.remainingTime,
      
      // Warnings
      showTracedWarning: this.network.traced,
      showMonitoredWarning: this.network.monitored,
      showBlackICEWarning: this.network.blackICE,
      
      // UI state
      passwordDisabled: lockoutInfo.isLocked,
      breachDisabled: lockoutInfo.isLocked || !canBreach
    };
  }

  /**
   * Activate event listeners
   * @override
   */
  activateListeners(html) {
    super.activateListeners(html);

    // Password input - Enter key submits
    html.find('#auth-password').on('keypress', (event) => {
      if (event.which === 13) {
        event.preventDefault();
        this._onConnect();
      }
    });
    
    // Connect button
    html.find('[data-action="connect"]').click(() => this._onConnect());
    
    // Breach button
    html.find('[data-action="breach"]').click(() => this._onBreach());
    
    // Cancel button
    html.find('[data-action="cancel"]').click(() => this.close());
    
    // Focus password field
    html.find('#auth-password').focus();
  }

  /**
   * Handle connect button click
   * @private
   */
  async _onConnect() {
    const password = this.element.find('#auth-password').val();
    
    if (!password) {
      ui.notifications.warn('Please enter a password');
      return;
    }
    
    const networkManager = game.nightcity?.networkManager;
    if (!networkManager) {
      ui.notifications.error('Network system not available');
      return;
    }
    
    // Disable form
    this._setFormDisabled(true);
    
    try {
      // Attempt authentication
      const result = await networkManager.authenticate(this.network.id, password);
      
      if (result.success) {
        // Success!
        ui.notifications.info(`Access granted to ${this.network.displayName || this.network.name}`);
        
        // Call success callback
        if (this.onSuccess) {
          await this.onSuccess(password);
        }
        
        // Close dialog
        this.close();
      } else {
        // Failed attempt
        this.attempts++;
        
        ui.notifications.error(`Access denied: ${result.message || 'Invalid password'}`);
        
        // Check if locked out
        if (this.attempts >= this.maxAttempts) {
          this._handleLockout();
        } else {
          // Re-enable form and update UI
          this._setFormDisabled(false);
          await this.render();
        }
      }
    } catch (error) {
      console.error('NCM | Authentication error:', error);
      ui.notifications.error(`Authentication failed: ${error.message}`);
      this._setFormDisabled(false);
    }
  }

  /**
   * Handle breach button click
   * @private
   */
  async _onBreach() {
    if (!this._canAttemptBreach()) {
      ui.notifications.warn('You lack the skills to attempt a breach');
      return;
    }
    
    const networkManager = game.nightcity?.networkManager;
    if (!networkManager) {
      ui.notifications.error('Network system not available');
      return;
    }
    
    if (!this.actor) {
      ui.notifications.warn('No character selected');
      return;
    }
    
    // Disable form
    this._setFormDisabled(true);
    
    try {
      // Attempt bypass using the HackingSystem
      const result = await networkManager.attemptBypass(this.network.id, this.actor);
      
      if (result.success) {
        // Success!
        ui.notifications.info(`Breach successful! Access granted to ${this.network.displayName || this.network.name}`);
        
        // NetWatch alert if traced
        if (this.network.traced) {
          this._triggerNetWatchAlert();
        }
        
        // Call success callback
        if (this.onSuccess) {
          await this.onSuccess(null);
        }
        
        // Close dialog
        this.close();
      } else {
        // Failed breach
        this.attempts++;
        
        ui.notifications.error(`Breach failed: ${result.message || 'Security held'}`);
        
        // NetWatch alert on failed breach
        if (this.network.monitored) {
          this._triggerNetWatchAlert();
        }
        
        // Check if locked out
        if (this.attempts >= this.maxAttempts) {
          this._handleLockout();
        } else {
          // Re-enable form and update UI
          this._setFormDisabled(false);
          await this.render();
        }
      }
    } catch (error) {
      console.error('NCM | Breach error:', error);
      ui.notifications.error(`Breach failed: ${error.message}`);
      this._setFormDisabled(false);
    }
  }

  /**
   * Check if actor can attempt breach
   * @private
   */
  _canAttemptBreach() {
    if (!this.actor) return false;
    
    // Check for relevant skills
    return this._hasSkill('interface') || 
           this._hasSkill('electronics') || 
           this._hasSkill('basic_tech');
  }

  /**
   * Check if actor has a specific skill
   * @private
   */
  _hasSkill(skillName) {
    if (!this.actor) return false;
    
    // This depends on the Cyberpunk RED system structure
    // Adjust based on actual system implementation
    const skills = this.actor.system?.skills;
    if (!skills) return false;
    
    return skills[skillName]?.value > 0 || false;
  }

  /**
   * Get best breach skill for the actor
   * @private
   */
  _getBestBreachSkill() {
    if (!this.actor) return null;
    
    const skills = this.actor.system?.skills;
    if (!skills) return null;
    
    const relevantSkills = [
      { name: 'Interface', key: 'interface', value: skills.interface?.value || 0 },
      { name: 'Electronics', key: 'electronics', value: skills.electronics?.value || 0 },
      { name: 'Basic Tech', key: 'basic_tech', value: skills.basic_tech?.value || 0 }
    ];
    
    const best = relevantSkills.reduce((prev, current) => 
      current.value > prev.value ? current : prev
    );
    
    return best.value > 0 ? best : null;
  }

  /**
   * Get breach DV based on security level
   * @private
   */
  _getBreachDV() {
    const securityLevel = this.network.security?.level || 'NONE';
    
    const dvMap = {
      'NONE': 10,
      'LOW': 13,
      'MEDIUM': 15,
      'HIGH': 17,
      'MAXIMUM': 21
    };
    
    return dvMap[securityLevel] || 15;
  }

  /**
   * Get security level description
   * @private
   */
  _getSecurityDescription(level) {
    const descriptions = {
      'NONE': 'Open access - No security',
      'LOW': 'Basic password protection',
      'MEDIUM': 'Standard corporate security',
      'HIGH': 'Military-grade encryption',
      'MAXIMUM': 'BLACK ICE protected - LETHAL'
    };
    
    return descriptions[level] || 'Unknown security level';
  }

  /**
   * Check for existing lockout
   * @private
   */
  _checkLockout() {
    const lockoutInfo = this._getLockoutInfo();
    
    if (lockoutInfo.isLocked) {
      ui.notifications.warn(
        `Network access locked. Try again in ${Math.ceil(lockoutInfo.remainingTime / 60)} minutes.`
      );
    }
  }

  /**
   * Get lockout information
   * @private
   */
  _getLockoutInfo() {
    const networkManager = game.nightcity?.networkManager;
    if (!networkManager) return { isLocked: false, remainingTime: 0 };
    
    const lockouts = networkManager.authLockouts || {};
    const lockout = lockouts[this.network.id];
    
    if (!lockout) return { isLocked: false, remainingTime: 0 };
    
    const now = Date.now();
    const remainingTime = Math.max(0, (lockout.until - now) / 1000);
    
    return {
      isLocked: remainingTime > 0,
      remainingTime: remainingTime
    };
  }

  /**
   * Handle lockout after max attempts
   * @private
   */
  _handleLockout() {
    const networkManager = game.nightcity?.networkManager;
    if (!networkManager) return;
    
    // Set lockout (15 minutes)
    const lockoutDuration = 15 * 60 * 1000;
    networkManager.authLockouts = networkManager.authLockouts || {};
    networkManager.authLockouts[this.network.id] = {
      until: Date.now() + lockoutDuration,
      attempts: this.attempts
    };
    
    ui.notifications.error(
      `Access denied! Network locked for 15 minutes after ${this.maxAttempts} failed attempts.`
    );
    
    // Trigger NetWatch alert
    if (this.network.monitored || this.network.traced) {
      this._triggerNetWatchAlert();
    }
    
    // Close dialog
    this.close();
  }

  /**
   * Trigger NetWatch alert
   * @private
   */
  _triggerNetWatchAlert() {
    // Create chat message
    ChatMessage.create({
      content: `
        <div class="ncm-netwatch-alert">
          <h3><i class="fas fa-shield-alt"></i> NETWATCH ALERT</h3>
          <p><strong>Unauthorized access attempt detected!</strong></p>
          <p>Network: ${this.network.displayName || this.network.name}</p>
          ${this.actor ? `<p>Suspect: ${this.actor.name}</p>` : ''}
          <p class="alert-warning">NetWatch has been notified and is investigating.</p>
        </div>
      `,
      type: CONST.CHAT_MESSAGE_TYPES.OOC,
      whisper: game.user.isGM ? null : [game.user.id]
    });
    
    // Visual feedback
    ui.notifications.warn('⚠️ NetWatch has detected your intrusion attempt!');
    
    // Emit event for GM tools
    game.nightcity?.eventBus?.emit('network:netwatch:alert', {
      network: this.network,
      actor: this.actor,
      timestamp: Date.now()
    });
  }

  /**
   * Disable/enable form inputs
   * @private
   */
  _setFormDisabled(disabled) {
    const element = this.element;
    if (!element) return;
    
    element.find('input, button').prop('disabled', disabled);
    
    if (disabled) {
      element.find('[data-action="connect"]').html('<i class="fas fa-spinner fa-spin"></i> Connecting...');
      element.find('[data-action="breach"]').html('<i class="fas fa-spinner fa-spin"></i> Breaching...');
    } else {
      element.find('[data-action="connect"]').html('Connect');
      element.find('[data-action="breach"]').html(`Attempt Breach (DV${this._getBreachDV()})`);
    }
  }
}