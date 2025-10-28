/**
 * Network Authentication Dialog
 * File: scripts/ui/dialogs/NetworkAuthDialog.js
 * Module: cyberpunkred-messenger
 * Description: Dialog for authenticating to secured networks with password or breach attempts
 */

const MODULE_ID = 'cyberpunkred-messenger';

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
    
    this.network = network;
    this.onSuccess = options.onSuccess;
    this.onCancel = options.onCancel;
    this.actor = options.actor || game.user.character;
    this.attempts = 0;
    this.maxAttempts = 3;
    
    // Check for lockout on creation
    this._checkLockout();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['ncm-network-auth-dialog', 'dialog'],
      template: 'modules/cyberpunkred-messenger/templates/dialogs/network-auth.hbs',
      width: 420,
      height: 'auto'
    });
  }

  async getData() {
    const data = await super.getData();
    const securityService = game.nightcity?.networkSecurityService;
    
    // Get authentication status if we have an actor
    let authStatus = null;
    if (this.actor && securityService) {
      authStatus = securityService.checkAuthentication(this.actor, this.network.id);
    }
    
    // Check if user can attempt breach
    const canBreach = this._canAttemptBreach();
    const breachDV = this._getBreachDV();
    const breachSkill = this._getBestBreachSkill();
    
    // Get lockout info
    const lockoutInfo = this._getLockoutInfo();
    
    return {
      ...data,
      network: {
        id: this.network.id,
        name: this.network.displayName || this.network.name,
        description: this.network.description || '',
        type: this.network.type,
        icon: this._getNetworkIcon(),
        color: this.network.color || '#F65261',
        securityLevel: this.network.security?.level || 'NONE',
        securityDescription: this._getSecurityDescription(this.network.security?.level),
        requiresAuth: this.network.requiresAuth || this.network.security?.requiresAuth,
        isTraced: this.network.traced || false,
        isMonitored: this.network.monitored || false,
        hasBlackICE: this.network.blackICE || (this.network.security?.level === 'MAXIMUM')
      },
      
      // Actor info
      actor: this.actor ? {
        name: this.actor.name,
        id: this.actor.id,
        hasInterface: this._hasSkill('Interface'),
        hasElectronics: this._hasSkill('Electronics/Security Tech'),
        hasBasicTech: this._hasSkill('Basic Tech')
      } : null,
      
      // Breach info
      canBreach: canBreach,
      breachDV: breachDV,
      breachSkill: breachSkill,
      
      // Attempt tracking
      attempts: this.attempts,
      maxAttempts: this.maxAttempts,
      attemptsRemaining: this.maxAttempts - this.attempts,
      isLocked: lockoutInfo.isLocked,
      lockoutTime: lockoutInfo.remainingTime,
      
      // Warnings
      showTracedWarning: this.network.traced || authStatus?.traced,
      showMonitoredWarning: this.network.monitored,
      showBlackICEWarning: this.network.blackICE || (this.network.security?.level === 'MAXIMUM'),
      
      // UI state
      passwordDisabled: lockoutInfo.isLocked,
      breachDisabled: lockoutInfo.isLocked || !canBreach
    };
  }

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
    setTimeout(() => {
      html.find('#auth-password').focus();
    }, 100);
  }

  /**
   * Handle connect button click (password auth)
   * @private
   */
  async _onConnect() {
    const password = this.element.find('#auth-password').val();
    
    if (!password) {
      ui.notifications.warn('Please enter a password');
      return;
    }
    
    const securityService = game.nightcity?.networkSecurityService;
    if (!securityService) {
      ui.notifications.error('Security system not available');
      return;
    }

    if (!this.actor) {
      ui.notifications.warn('No character selected');
      return;
    }
    
    // Disable form
    this._setFormDisabled(true);
    
    try {
      // Attempt authentication via security service
      const result = await securityService.attemptPasswordAuth(
        this.actor, 
        this.network.id, 
        password, 
        this.network
      );
      
      if (result.success) {
        // Success!
        ui.notifications.info(`Access granted to ${this.network.displayName || this.network.name}`);
        
        // Call success callback
        if (this.onSuccess) {
          await this.onSuccess();
        }
        
        // Close dialog
        this.close();
      } else if (result.reason === 'locked_out') {
        // Locked out
        ui.notifications.error(`Access denied! Locked out for ${result.lockedMinutes} minutes.`);
        this.close();
      } else if (result.reason === 'incorrect_password') {
        // Failed attempt
        this.attempts++;
        ui.notifications.error(`Access denied! ${result.attemptsRemaining} attempts remaining.`);
        
        // Re-enable form and update UI
        this._setFormDisabled(false);
        this.element.find('#auth-password').val('').focus();
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Authentication error:`, error);
      ui.notifications.error(`Authentication failed: ${error.message}`);
      this._setFormDisabled(false);
    }
  }

  /**
   * Handle breach button click (hacking)
   * @private
   */
  async _onBreach() {
    if (!this._canAttemptBreach()) {
      ui.notifications.warn('You lack the skills to attempt a breach');
      return;
    }
    
    const securityService = game.nightcity?.networkSecurityService;
    if (!securityService) {
      ui.notifications.error('Security system not available');
      return;
    }
    
    if (!this.actor) {
      ui.notifications.warn('No character selected');
      return;
    }
    
    // Confirm the attempt
    const confirmed = await Dialog.confirm({
      title: "Attempt Security Breach?",
      content: `
        <div style="font-family: 'Rajdhani', sans-serif; padding: 10px;">
          <p style="color: #FFC107; margin-bottom: 12px;">
            <i class="fas fa-exclamation-triangle"></i> 
            <strong>WARNING:</strong> This is a risky operation!
          </p>
          <p>Attempting to breach <strong>${this.network.name}</strong></p>
          <p><strong>Security Level:</strong> ${this.network.security?.level || 'UNKNOWN'}</p>
          <p><strong>Difficulty:</strong> DV ${this._getBreachDV()}</p>
          <hr style="border-color: rgba(255,255,255,0.2); margin: 12px 0;">
          <p style="color: #F65261; font-size: 0.9em;">
            <strong>Failure may result in:</strong><br>
            • BLACK ICE damage<br>
            • Network lockout<br>
            • NetWatch alerts<br>
            • Being traced
          </p>
        </div>
      `,
      defaultYes: false
    });
    
    if (!confirmed) return;
    
    // Disable form
    this._setFormDisabled(true);
    
    try {
      // Attempt bypass via security service
      const result = await securityService.attemptBypass(
        this.actor,
        this.network.id,
        this.network
      );
      
      if (result.success) {
        // Success!
        ui.notifications.info(`Breach successful! Temporary access granted.`);
        
        if (result.traced) {
          ui.notifications.warn('⚠️ Warning: Your connection may be traced!');
        }
        
        // Call success callback
        if (this.onSuccess) {
          await this.onSuccess();
        }
        
        // Close dialog
        this.close();
      } else if (result.reason === 'locked_out') {
        // Was already locked
        ui.notifications.error(`Access denied! Locked out for ${result.lockedMinutes} minutes.`);
        this.close();
      } else if (result.reason === 'bypass_failed') {
        // Failed breach - dramatic!
        ui.notifications.error('💀 BREACH FAILED! BLACK ICE activated!');
        
        if (result.damage && result.damage.total > 0) {
          ui.notifications.error(`You take ${result.damage.total} damage from BLACK ICE!`);
        }
        
        if (result.netWatchAlert) {
          ui.notifications.warn('⚠️ NETWATCH ALERTED! You are being traced!');
        }
        
        // Close after showing results
        setTimeout(() => this.close(), 2000);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Breach error:`, error);
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
    return this._hasSkill('Interface') || 
           this._hasSkill('Electronics/Security Tech') || 
           this._hasSkill('Basic Tech');
  }

  /**
   * Check if actor has a specific skill
   * @private
   */
  _hasSkill(skillName) {
    if (!this.actor) return false;
    
    // Check actor items for skill
    const skillItem = this.actor.items.find(i => 
      i.type === 'skill' && i.name === skillName
    );
    
    return skillItem && skillItem.system?.level > 0;
  }

  /**
   * Get best breach skill for the actor
   * @private
   */
  _getBestBreachSkill() {
    if (!this.actor) return null;
    
    const relevantSkills = [
      { name: 'Interface', key: 'Interface' },
      { name: 'Electronics/Security Tech', key: 'Electronics/Security Tech' },
      { name: 'Basic Tech', key: 'Basic Tech' }
    ];
    
    let bestSkill = null;
    let bestValue = 0;
    
    for (const skill of relevantSkills) {
      const skillItem = this.actor.items.find(i => 
        i.type === 'skill' && i.name === skill.key
      );
      
      if (skillItem) {
        const value = skillItem.system?.level || 0;
        if (value > bestValue) {
          bestValue = value;
          bestSkill = { name: skill.name, value: value };
        }
      }
    }
    
    return bestSkill;
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
   * Get network type icon
   * @private
   */
  _getNetworkIcon() {
    if (this.network.icon) return this.network.icon;
    
    const iconMap = {
      'PUBLIC': 'fa-wifi',
      'CORPORATE': 'fa-building',
      'DARKNET': 'fa-user-secret',
      'MILITARY': 'fa-shield-alt',
      'CUSTOM': 'fa-network-wired'
    };
    
    return iconMap[this.network.type] || 'fa-wifi';
  }

  /**
   * Check for existing lockout
   * @private
   */
  _checkLockout() {
    const lockoutInfo = this._getLockoutInfo();
    
    if (lockoutInfo.isLocked) {
      const minutes = Math.ceil(lockoutInfo.remainingTime / 60);
      ui.notifications.warn(
        `Network access locked. Try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`
      );
    }
  }

  /**
   * Get lockout information
   * @private
   */
  _getLockoutInfo() {
    if (!this.actor) {
      return { isLocked: false, remainingTime: 0 };
    }
    
    const securityService = game.nightcity?.networkSecurityService;
    if (!securityService) {
      return { isLocked: false, remainingTime: 0 };
    }
    
    const authStatus = securityService.checkAuthentication(this.actor, this.network.id);
    
    if (authStatus.reason === 'locked_out') {
      return {
        isLocked: true,
        remainingTime: (authStatus.lockedMinutes || 0) * 60
      };
    }
    
    return { isLocked: false, remainingTime: 0 };
  }

  /**
   * Disable/enable form inputs
   * @private
   */
  _setFormDisabled(disabled) {
    const element = this.element;
    if (!element || !element.length) return;
    
    element.find('input, button').prop('disabled', disabled);
    
    if (disabled) {
      const connectBtn = element.find('[data-action="connect"]');
      const breachBtn = element.find('[data-action="breach"]');
      
      if (connectBtn.length) {
        connectBtn.html('<i class="fas fa-spinner fa-spin"></i> Connecting...');
      }
      if (breachBtn.length) {
        breachBtn.html('<i class="fas fa-spinner fa-spin"></i> Breaching...');
      }
    } else {
      const connectBtn = element.find('[data-action="connect"]');
      const breachBtn = element.find('[data-action="breach"]');
      
      if (connectBtn.length) {
        connectBtn.html('<i class="fas fa-plug"></i> Connect');
      }
      if (breachBtn.length) {
        breachBtn.html(`<i class="fas fa-user-secret"></i> Attempt Breach (DV${this._getBreachDV()})`);
      }
    }
  }
}