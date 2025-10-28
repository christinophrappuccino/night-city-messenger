/**
 * Network Security Service
 * File: scripts/services/NetworkSecurityService.js
 * Module: cyberpunkred-messenger
 * Description: Handles network authentication, bypass attempts, lockouts, BLACK ICE, and NetWatch alerts
 */

const MODULE_ID = 'cyberpunkred-messenger';

export class NetworkSecurityService {
  constructor() {
    this.MAX_AUTH_ATTEMPTS = 3;
    this.LOCKOUT_DURATION = 30; // minutes
    this.BYPASS_DURATION = 60; // minutes  
    this.NETWATCH_ALERT_CHANCE = 0.8; // 80% on failed bypass
    
    // BLACK ICE damage by security level
    this.BLACK_ICE_DAMAGE = {
      'NONE': '0',
      'LOW': '1d6',
      'MEDIUM': '2d6',
      'HIGH': '3d6',
      'MAXIMUM': '5d6'
    };
    
    console.log(`${MODULE_ID} | NetworkSecurityService initialized`);
  }

  /**
   * Check if actor is authenticated for a network
   * @param {Actor} actor - The actor attempting connection
   * @param {string} networkId - Network identifier
   * @returns {Object} Authentication status
   */
  checkAuthentication(actor, networkId) {
    if (!actor || !networkId) {
      return { authenticated: false, reason: 'invalid_params' };
    }

    const authData = actor.getFlag(MODULE_ID, 'networkAuth') || {};
    const networkAuth = authData[networkId];

    if (!networkAuth) {
      return { authenticated: false, reason: 'no_credentials' };
    }

    // Check lockout
    if (networkAuth.lockedUntil) {
      const lockoutEnd = new Date(networkAuth.lockedUntil);
      if (Date.now() < lockoutEnd.getTime()) {
        const remaining = Math.ceil((lockoutEnd.getTime() - Date.now()) / 60000);
        return { 
          authenticated: false, 
          reason: 'locked_out',
          lockedMinutes: remaining
        };
      }
    }

    // Check bypass expiration
    if (networkAuth.bypassActive && networkAuth.expiresAt) {
      const expiresAt = new Date(networkAuth.expiresAt);
      if (Date.now() > expiresAt.getTime()) {
        return { authenticated: false, reason: 'bypass_expired' };
      }
      return { 
        authenticated: true, 
        temporary: true, 
        traced: networkAuth.traced || false,
        expiresAt: networkAuth.expiresAt
      };
    }

    // Check permanent authentication
    if (networkAuth.authenticated) {
      if (networkAuth.expiresAt) {
        const expiresAt = new Date(networkAuth.expiresAt);
        if (Date.now() > expiresAt.getTime()) {
          return { authenticated: false, reason: 'credentials_expired' };
        }
      }
      return { authenticated: true, temporary: false };
    }

    return { authenticated: false, reason: 'not_authenticated' };
  }

  /**
   * Attempt password authentication
   * @param {Actor} actor - The actor attempting authentication
   * @param {string} networkId - Network identifier
   * @param {string} password - Password attempt
   * @param {Object} network - Network configuration
   * @returns {Promise<Object>} Authentication result
   */
  async attemptPasswordAuth(actor, networkId, password, network) {
    const authData = actor.getFlag(MODULE_ID, 'networkAuth') || {};
    const networkAuth = authData[networkId] || {
      authenticated: false,
      attempts: 0,
      lockedUntil: null,
      traced: false
    };

    // Check lockout
    const authCheck = this.checkAuthentication(actor, networkId);
    if (authCheck.reason === 'locked_out') {
      return {
        success: false,
        reason: 'locked_out',
        lockedMinutes: authCheck.lockedMinutes
      };
    }

    // Validate password
    const correctPassword = network.security?.password || '';
    const success = password === correctPassword || this._hashPassword(password) === correctPassword;

    if (success) {
      // Grant access
      networkAuth.authenticated = true;
      networkAuth.attempts = 0;
      networkAuth.expiresAt = null; // Permanent
      networkAuth.lockedUntil = null;
      networkAuth.bypassActive = false;
      
      await actor.setFlag(MODULE_ID, 'networkAuth', {
        ...authData,
        [networkId]: networkAuth
      });

      // Post to chat
      await this._postAuthSuccessChat(actor, network);

      return { success: true, permanent: true };
    } else {
      // Failed attempt
      networkAuth.attempts = (networkAuth.attempts || 0) + 1;
      const attemptsRemaining = this.MAX_AUTH_ATTEMPTS - networkAuth.attempts;

      if (attemptsRemaining <= 0) {
        // Lockout
        const lockoutEnd = new Date(Date.now() + (this.LOCKOUT_DURATION * 60000));
        networkAuth.lockedUntil = lockoutEnd.toISOString();
        
        await actor.setFlag(MODULE_ID, 'networkAuth', {
          ...authData,
          [networkId]: networkAuth
        });

        await this._postLockoutChat(actor, network, this.LOCKOUT_DURATION);

        return {
          success: false,
          reason: 'locked_out',
          lockedMinutes: this.LOCKOUT_DURATION
        };
      } else {
        // Still has attempts
        await actor.setFlag(MODULE_ID, 'networkAuth', {
          ...authData,
          [networkId]: networkAuth
        });

        return {
          success: false,
          reason: 'incorrect_password',
          attemptsRemaining
        };
      }
    }
  }

  /**
   * Attempt security bypass (hacking)
   * @param {Actor} actor - The actor attempting bypass
   * @param {string} networkId - Network identifier
   * @param {Object} network - Network configuration
   * @returns {Promise<Object>} Bypass result
   */
  async attemptBypass(actor, networkId, network) {
    const authData = actor.getFlag(MODULE_ID, 'networkAuth') || {};
    const networkAuth = authData[networkId] || {
      authenticated: false,
      attempts: 0,
      lockedUntil: null,
      traced: false
    };

    // Check lockout
    const authCheck = this.checkAuthentication(actor, networkId);
    if (authCheck.reason === 'locked_out') {
      return {
        success: false,
        reason: 'locked_out',
        lockedMinutes: authCheck.lockedMinutes
      };
    }

    // Get security DV
    const securityLevel = network.security?.level || 'LOW';
    const dv = this._getSecurityDV(securityLevel);

    // Determine best skill
    const skillInfo = this._determineBestSkill(actor);
    if (!skillInfo) {
      return {
        success: false,
        reason: 'no_skills',
        message: 'You lack the necessary skills to attempt a breach'
      };
    }
    
    // Make skill check using SkillService
    const result = await this._performSkillCheck(actor, skillInfo.skillName, dv);

    if (result.success) {
      // Grant temporary access
      const expiresAt = new Date(Date.now() + (this.BYPASS_DURATION * 60000));
      networkAuth.bypassActive = true;
      networkAuth.authenticated = false; // It's a bypass, not auth
      networkAuth.expiresAt = expiresAt.toISOString();
      networkAuth.attempts = 0;
      networkAuth.lockedUntil = null;
      networkAuth.traced = Math.random() < 0.3; // 30% chance of being traced

      await actor.setFlag(MODULE_ID, 'networkAuth', {
        ...authData,
        [networkId]: networkAuth
      });

      await this._postBypassSuccessChat(
        actor, 
        network, 
        result, 
        this.BYPASS_DURATION, 
        networkAuth.traced
      );

      return {
        success: true,
        temporary: true,
        duration: this.BYPASS_DURATION,
        traced: networkAuth.traced,
        roll: result
      };
    } else {
      // Failed bypass - consequences!
      networkAuth.attempts = (networkAuth.attempts || 0) + 1;
      const lockoutEnd = new Date(Date.now() + (this.LOCKOUT_DURATION * 60000));
      networkAuth.lockedUntil = lockoutEnd.toISOString();
      networkAuth.traced = true; // Always traced on failed bypass

      await actor.setFlag(MODULE_ID, 'networkAuth', {
        ...authData,
        [networkId]: networkAuth
      });

      // NetWatch alert
      const alertTriggered = Math.random() < this.NETWATCH_ALERT_CHANCE;
      if (alertTriggered) {
        await this._triggerNetWatchAlert(actor, network);
      }

      // BLACK ICE damage
      const damage = await this._applyBlackICEDamage(actor, securityLevel);

      await this._postBypassFailureChat(
        actor, 
        network, 
        result, 
        damage, 
        alertTriggered, 
        this.LOCKOUT_DURATION
      );

      return {
        success: false,
        reason: 'bypass_failed',
        traced: true,
        netWatchAlert: alertTriggered,
        damage: damage,
        lockedMinutes: this.LOCKOUT_DURATION,
        roll: result
      };
    }
  }

  /**
   * GM force unlock (bypass all security)
   * @param {Actor} actor - The actor to grant access
   * @param {string} networkId - Network identifier
   */
  async gmForceUnlock(actor, networkId) {
    if (!game.user.isGM) {
      ui.notifications.error("Only GMs can force unlock networks");
      return;
    }

    const authData = actor.getFlag(MODULE_ID, 'networkAuth') || {};
    authData[networkId] = {
      authenticated: true,
      expiresAt: null,
      bypassActive: false,
      attempts: 0,
      lockedUntil: null,
      traced: false
    };

    await actor.setFlag(MODULE_ID, 'networkAuth', authData);
    ui.notifications.info(`GM Override: ${actor.name} granted access to ${networkId}`);
  }

  /**
   * GM reset authentication
   * @param {Actor} actor - The actor to reset
   * @param {string} networkId - Network identifier (or null for all)
   */
  async gmResetAuth(actor, networkId = null) {
    if (!game.user.isGM) {
      ui.notifications.error("Only GMs can reset authentication");
      return;
    }

    if (networkId) {
      const authData = actor.getFlag(MODULE_ID, 'networkAuth') || {};
      delete authData[networkId];
      await actor.setFlag(MODULE_ID, 'networkAuth', authData);
      ui.notifications.info(`Authentication reset for ${networkId}`);
    } else {
      await actor.unsetFlag(MODULE_ID, 'networkAuth');
      ui.notifications.info(`All authentication reset for ${actor.name}`);
    }
  }

  // ===== PRIVATE METHODS =====

  /**
   * Get security DV based on level
   * @private
   */
  _getSecurityDV(securityLevel) {
    const dvMap = {
      'NONE': 0,
      'LOW': 13,
      'MEDIUM': 15,
      'HIGH': 17,
      'MAXIMUM': 21
    };
    return dvMap[securityLevel] || 15;
  }

  /**
   * Determine best skill for actor
   * @private
   */
  _determineBestSkill(actor) {
    if (!actor) return null;
    
    // Try to find skills via items (Cyberpunk RED uses items for skills)
    const skills = actor.items.filter(i => i.type === 'skill');
    
    const relevantSkills = [
      { 
        name: 'Interface', 
        item: skills.find(s => s.name === 'Interface'),
        preferredStat: 'int'
      },
      { 
        name: 'Electronics/Security Tech', 
        item: skills.find(s => s.name === 'Electronics/Security Tech'),
        preferredStat: 'tech'
      },
      { 
        name: 'Basic Tech', 
        item: skills.find(s => s.name === 'Basic Tech'),
        preferredStat: 'tech'
      }
    ];

    // Find best available skill
    for (const skill of relevantSkills) {
      if (skill.item && skill.item.system?.level > 0) {
        return {
          skillName: skill.name,
          skillValue: skill.item.system.level,
          stat: skill.preferredStat
        };
      }
    }

    return null;
  }

  /**
   * Perform skill check using SkillService
   * @private
   */
  async _performSkillCheck(actor, skillName, dv) {
    // Use existing SkillService if available
    const SkillService = game.nightcity?.SkillService;
    
    if (SkillService) {
      try {
        const result = await SkillService.performCheck({
          actor: actor,
          skills: [skillName],
          dc: dv,
          taskName: `Breaching Network Security`,
          allowLuck: true,
          autoRoll: false
        });
        
        return {
          success: result.success,
          roll: result.roll,
          total: result.total || result.roll?.total,
          dv: dv,
          skillName: skillName
        };
      } catch (error) {
        console.error(`${MODULE_ID} | SkillService check failed:`, error);
      }
    }
    
    // Fallback: manual roll
    const skillItem = actor.items.find(i => i.type === 'skill' && i.name === skillName);
    const skillValue = skillItem?.system?.level || 0;
    const statValue = actor.system?.stats?.int?.value || 0;
    
    const roll = await new Roll(`1d10 + ${skillValue} + ${statValue}`).evaluate();
    const success = roll.total >= dv;

    return {
      success,
      roll,
      total: roll.total,
      dv,
      skillName,
      skillValue,
      statValue
    };
  }

  /**
   * Apply BLACK ICE damage
   * @private
   */
  async _applyBlackICEDamage(actor, securityLevel) {
    const damageFormula = this.BLACK_ICE_DAMAGE[securityLevel] || '2d6';
    
    if (damageFormula === '0') {
      return { formula: '0', total: 0, roll: null };
    }
    
    const damageRoll = await new Roll(damageFormula).evaluate();
    
    // Apply damage to actor HP
    const currentHP = actor.system.derivedStats?.hp?.value || actor.system.hp?.value || 0;
    const newHP = Math.max(0, currentHP - damageRoll.total);
    
    try {
      // Try different HP paths for different system versions
      if (actor.system.derivedStats?.hp) {
        await actor.update({ 'system.derivedStats.hp.value': newHP });
      } else if (actor.system.hp) {
        await actor.update({ 'system.hp.value': newHP });
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not apply BLACK ICE damage:`, error);
    }

    return {
      formula: damageFormula,
      total: damageRoll.total,
      roll: damageRoll
    };
  }

  /**
   * Trigger NetWatch alert
   * @private
   */
  async _triggerNetWatchAlert(actor, network) {
    await ChatMessage.create({
      content: `
        <div class="ncm-chat-card ncm-netwatch-alert" style="
          background: linear-gradient(135deg, #1a0000 0%, #4a0000 100%);
          border: 2px solid #F65261;
          padding: 16px;
          border-radius: 4px;
          box-shadow: 0 0 20px rgba(246, 82, 97, 0.4);
        ">
          <h3 style="
            margin: 0 0 12px 0;
            color: #F65261;
            text-shadow: 0 0 10px #F65261;
            font-family: 'Rajdhani', sans-serif;
            font-size: 20px;
            letter-spacing: 2px;
          ">
            <i class="fas fa-shield-alt"></i> ⚠️ NETWATCH ALERT
          </h3>
          <div style="
            background: rgba(0,0,0,0.4);
            padding: 12px;
            border-radius: 3px;
            border-left: 3px solid #F65261;
          ">
            <p style="margin: 4px 0;"><strong>UNAUTHORIZED ACCESS ATTEMPT DETECTED</strong></p>
            <p style="margin: 4px 0;"><strong>Target Network:</strong> ${network.name}</p>
            <p style="margin: 4px 0;"><strong>Suspect:</strong> ${actor.name}</p>
            <p style="margin: 4px 0; color: #19f3f7;"><strong>Status:</strong> TRACED - Monitoring Active</p>
          </div>
        </div>
      `,
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
      flags: {
        [MODULE_ID]: {
          type: 'netwatch-alert',
          networkId: network.id,
          actorId: actor.id
        }
      }
    });
  }

  /**
   * Post authentication success to chat
   * @private
   */
  async _postAuthSuccessChat(actor, network) {
    await ChatMessage.create({
      content: `
        <div class="ncm-chat-card" style="
          background: linear-gradient(135deg, #001a00 0%, #004a00 100%);
          border: 2px solid #4CAF50;
          padding: 16px;
          border-radius: 4px;
        ">
          <h3 style="margin: 0 0 8px 0; color: #4CAF50; font-family: 'Rajdhani', sans-serif;">
            <i class="fas fa-check-circle"></i> Authentication Successful
          </h3>
          <p style="margin: 4px 0;">${actor.name} connected to <strong>${network.name}</strong></p>
          <p style="margin: 4px 0; color: #4CAF50;"><em>Access granted - Credentials verified</em></p>
        </div>
      `,
      speaker: ChatMessage.getSpeaker({ actor }),
      flags: {
        [MODULE_ID]: {
          type: 'auth-success'
        }
      }
    });
  }

  /**
   * Post lockout message to chat
   * @private
   */
  async _postLockoutChat(actor, network, duration) {
    await ChatMessage.create({
      content: `
        <div class="ncm-chat-card" style="
          background: linear-gradient(135deg, #1a0000 0%, #4a0000 100%);
          border: 2px solid #F65261;
          padding: 16px;
          border-radius: 4px;
        ">
          <h3 style="margin: 0 0 8px 0; color: #F65261; font-family: 'Rajdhani', sans-serif;">
            <i class="fas fa-lock"></i> Access Denied - Locked Out
          </h3>
          <p style="margin: 4px 0;">${actor.name} failed to connect to <strong>${network.name}</strong></p>
          <p style="margin: 4px 0; color: #F65261;"><strong>Too many failed attempts</strong></p>
          <p style="margin: 4px 0;">Locked out for <strong>${duration} minutes</strong></p>
        </div>
      `,
      speaker: ChatMessage.getSpeaker({ actor }),
      flags: {
        [MODULE_ID]: {
          type: 'auth-lockout'
        }
      }
    });
  }

  /**
   * Post bypass success to chat
   * @private
   */
  async _postBypassSuccessChat(actor, network, result, duration, traced) {
    await ChatMessage.create({
      content: `
        <div class="ncm-chat-card" style="
          background: linear-gradient(135deg, #0a001a 0%, #1a004a 100%);
          border: 2px solid #9C27B0;
          padding: 16px;
          border-radius: 4px;
        ">
          <h3 style="margin: 0 0 8px 0; color: #9C27B0; font-family: 'Rajdhani', sans-serif;">
            <i class="fas fa-user-secret"></i> ⚡ Security Bypassed
          </h3>
          <p style="margin: 4px 0;">${actor.name} breached <strong>${network.name}</strong></p>
          <p style="margin: 4px 0;"><strong>Skill Check:</strong> ${result.skillName} (${result.total} vs DV ${result.dv})</p>
          <p style="margin: 4px 0; color: #9C27B0;">Temporary access granted for ${duration} minutes</p>
          ${traced ? '<p style="margin: 4px 0; color: #FFC107;"><i class="fas fa-exclamation-triangle"></i> <strong>WARNING:</strong> Connection may be traced</p>' : ''}
        </div>
      `,
      speaker: ChatMessage.getSpeaker({ actor }),
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      rolls: result.roll ? [result.roll] : [],
      flags: {
        [MODULE_ID]: {
          type: 'bypass-success'
        }
      }
    });
  }

  /**
   * Post bypass failure to chat
   * @private
   */
  async _postBypassFailureChat(actor, network, result, damage, netWatchAlert, lockoutDuration) {
    const rolls = [result.roll];
    if (damage.roll) rolls.push(damage.roll);
    
    await ChatMessage.create({
      content: `
        <div class="ncm-chat-card" style="
          background: linear-gradient(135deg, #1a0000 0%, #330000 100%);
          border: 2px solid #F65261;
          padding: 16px;
          border-radius: 4px;
          box-shadow: 0 0 30px rgba(246, 82, 97, 0.5);
        ">
          <h3 style="margin: 0 0 12px 0; color: #F65261; font-family: 'Rajdhani', sans-serif; text-shadow: 0 0 10px #F65261;">
            <i class="fas fa-skull-crossbones"></i> 💀 BREACH FAILED!
          </h3>
          <p style="margin: 4px 0;">${actor.name} failed to breach <strong>${network.name}</strong></p>
          <p style="margin: 4px 0;"><strong>Skill Check:</strong> ${result.skillName} (${result.total} vs DV ${result.dv})</p>
          <div style="background: rgba(246, 82, 97, 0.2); padding: 8px; margin: 8px 0; border-left: 3px solid #F65261;">
            <p style="margin: 4px 0; color: #F65261; font-weight: bold;">
              <i class="fas fa-bolt"></i> BLACK ICE Damage: ${damage.total} HP
            </p>
          </div>
          <p style="margin: 4px 0; color: #FF5722;">Locked out for ${lockoutDuration} minutes</p>
          ${netWatchAlert ? '<p style="margin: 8px 0 0 0; color: #FFC107; font-weight: bold; animation: pulse 1s infinite;"><i class="fas fa-exclamation-triangle"></i> ⚠️ NETWATCH ALERTED - YOU ARE TRACED</p>' : ''}
        </div>
      `,
      speaker: ChatMessage.getSpeaker({ actor }),
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      rolls: rolls.filter(r => r),
      flags: {
        [MODULE_ID]: {
          type: 'bypass-failure'
        }
      }
    });
  }

  /**
   * Simple password hash (matches NetworkManager)
   * @private
   */
  _hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}