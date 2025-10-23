/**
 * Item Inbox Application (Enhanced)
 * File: scripts/ui/components/ItemInbox/ItemInboxApp.js
 * Module: cyberpunkred-messenger
 * Description: View messages stored in items (data shards)
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';
import { DataShardService } from '../../../services/DataShardService.js';
import { SkillService } from '../../../services/SkillService.js';
import { NetworkService } from '../../../services/NetworkService.js';
import { EVENTS, EventBus } from '../../../core/EventBus.js'; 

export class ItemInboxApp extends BaseApplication {
  constructor(item, options = {}) {
    super(options);
    
    this.item = item;
    this.gmViewAllMode = false;
    this.gmViewAsPlayer = false;
    
    // Check if item is a data shard
    if (!this.item.getFlag(MODULE_ID, 'isDataShard')) {
      ui.notifications.error('This item is not configured as a data shard');
      throw new Error('Item is not a data shard');
    }
    
    // Initialize EventBus
    const eventBus = EventBus.getInstance();
    
    // Initialize services
    this.dataShardService = new DataShardService(eventBus);
    this.skillService = new SkillService(eventBus); // ADD THIS
    
    // NEW: Initialize NetworkService
    this.networkService = new NetworkService(
      game.nightcity?.stateManager || this._getStateManager(),
      eventBus
    );
    
    // State
    this.selectedMessageId = null;
    this.messages = [];
    this.attemptingHack = false;
    
    // Load messages
    this._loadMessages();
    
    // Setup event listeners
    this._setupEvents();
  }
  
  /**
   * Default options
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-item-inbox"],
      template: `modules/${MODULE_ID}/templates/item-inbox/item-inbox.hbs`,
      width: 900,
      height: 700,
      minWidth: 700,
      minHeight: 600,
      resizable: true,
      minimizable: true,
      draggable: true,
      left: null,
      top: null,
      dragDrop: [],
      tabs: [],
      scrollY: []
    });
  }

  /**
   * Override _render to ensure messages are loaded
   * @override
   */
  async _render(force = false, options = {}) {
    // Load messages before first render
    if (!this._messagesLoaded) {
      await this._loadMessages();
      this._messagesLoaded = true;
    }
    
    return super._render(force, options);
  }
  
  /**
   * Get window title
   */
  get title() {
    return `Data Shard: ${this.item.name}`;
  }

  /**
   * Get state manager (fallback if game.nightcity not initialized)
   * @private
   */
  _getStateManager() {
    // Return a minimal state manager if needed
    if (!game.nightcity?.stateManager) {
      return {
        get: (key) => {
          const defaults = {
            currentNetwork: 'CITINET',
            signalStrength: 100
          };
          return defaults[key];
        },
        set: (key, value) => {
          console.log(`${MODULE_ID} | StateManager not initialized, skipping set: ${key}`);
        }
      };
    }
    return game.nightcity.stateManager;
  }
  
  /**
   * Get data for template
   */
  async getData() {
    const data = await super.getData();
    
    // Basic flags
    const encrypted = this.item.getFlag(MODULE_ID, 'encrypted') || false;
    const encryptionDC = this.item.getFlag(MODULE_ID, 'encryptionDC') || 15;
    const encryptionType = this.item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
    const encryptionMode = this.item.getFlag(MODULE_ID, 'encryptionMode') || 'shard';
    const failureMode = this.item.getFlag(MODULE_ID, 'failureMode') || 'lockout';
    const dataShardType = this.item.getFlag(MODULE_ID, 'singleMessage') ? 'single' : 'multi';
    const theme = this.item.getFlag(MODULE_ID, 'theme') || 'default';
    
    // ========================================================================
    // NEW: GM VIEW AS PLAYER MODE
    // ========================================================================
    // If GM has "view as player" enabled, treat them like a regular user
    const gmViewAsPlayer = this.gmViewAsPlayer || false;
    const effectiveIsGM = game.user.isGM && !gmViewAsPlayer;
    const effectiveGmViewAllMode = this.gmViewAllMode && !gmViewAsPlayer;
    
    // ========================================================================
    // SECURITY LAYER 1 - NETWORK REQUIREMENT
    // ========================================================================
    const networkCheck = this.networkService.checkNetworkRequirement(this.item);
    const networkOverride = this.item.getFlag(MODULE_ID, 'networkOverride') || false;
    const networkBlocked = networkCheck.required && 
                           !networkCheck.accessible && 
                           !networkOverride;
    
    // ========================================================================
    // SECURITY LAYER 2 - LOGIN REQUIREMENT
    // ========================================================================
    const requiresLogin = this.item.getFlag(MODULE_ID, 'requiresLogin') || false;
    const sessionLoggedIn = this.item.getFlag(MODULE_ID, 'sessionLoggedIn') || false;
    const loginBlocked = requiresLogin && !sessionLoggedIn;
    
    // ========================================================================
    // SECURITY LAYER 3 - ENCRYPTION
    // ========================================================================
    const isActuallyDecrypted = this.item.getFlag(MODULE_ID, 'decrypted') || false;
    const shardEncryptionActive = encrypted && 
                                   (encryptionMode === 'shard' || encryptionMode === 'both');
    const encryptionBlocked = shardEncryptionActive && !isActuallyDecrypted;
    
    // ========================================================================
    // LOCKOUT STATE
    // ========================================================================
    const lockoutUntil = this.item.getFlag(MODULE_ID, 'lockoutUntil');
    const isLockedOut = lockoutUntil && Date.now() < new Date(lockoutUntil).getTime();
    const lockoutMinutes = isLockedOut 
      ? Math.ceil((new Date(lockoutUntil).getTime() - Date.now()) / 60000)
      : 0;
    
    // ========================================================================
    // DETERMINE WHICH OVERLAY TO SHOW (Priority Order)
    // ========================================================================
    let activeOverlay = null;

    // Priority 1: Network (most fundamental)
    if (networkBlocked && !effectiveGmViewAllMode && !effectiveIsGM) {
      activeOverlay = 'network';
    }
    // Priority 2: Login (authentication)
    else if (loginBlocked && !effectiveGmViewAllMode && !effectiveIsGM) {
      activeOverlay = 'login';
    }
    // Priority 3: Encryption (data protection)
    else if (encryptionBlocked && !effectiveGmViewAllMode && !effectiveIsGM) {
      activeOverlay = 'encryption';
    }

    // Can we access the inbox?
    const canAccessInbox = !activeOverlay || effectiveGmViewAllMode || effectiveIsGM;

    // ========================================================================
    // DETERMINE WHICH OVERLAY TO SHOW (Priority Order)
    // ========================================================================
    
    // ========================================================================
    // MESSAGES (only load if can access)
    // ========================================================================
    let messages = [];
    let selectedMessage = null;
    
    if (canAccessInbox) {
      messages = await this.dataShardService.getMessages(this.item);
      
      if (this.selectedMessageId) {
        const msg = messages.find(m => m.id === this.selectedMessageId);
        if (msg) {
          const messageEncrypted = msg.encryption && !msg.messageData.decrypted;
          const messageDecrypted = msg.messageData.decrypted;
          const hasCharacter = !!game.user.character;
          
          const showContent = !messageEncrypted || messageDecrypted || effectiveGmViewAllMode;
          const showEncryptedOverlay = messageEncrypted && !messageDecrypted && !effectiveGmViewAllMode;
          const canDecryptMessage = messageEncrypted && !messageDecrypted && hasCharacter && !effectiveIsGM;
          
          selectedMessage = {
            ...msg,
            messageData: msg.messageData || {},
            content: msg.content || '',
            canView: canAccessInbox,
            attachments: msg.attachments || [],
            infected: msg.messageData?.infected || false,
            malwareType: msg.messageData?.malwareType || null,
            threatLevel: msg.messageData?.threatLevel || 'unknown',
            showContent,
            showEncryptedOverlay,
            canDecrypt: canDecryptMessage,
            encryption: msg.encryption || null
          };
        }
      }
    }
    
    // ========================================================================
    // HACK HISTORY
    // ========================================================================
    const previousAttempts = this.item.getFlag(MODULE_ID, 'hackAttempts') || 0;
    const maxAttempts = this.item.getFlag(MODULE_ID, 'maxHackAttempts') || 3;
    const selectedActor = game.user.character;
    const hasCharacter = !!selectedActor;
    
    // Can user attempt to hack?
    const canHackShard = hasCharacter && 
                         encryptionBlocked && 
                         !isLockedOut &&
                         !effectiveGmViewAllMode &&
                         !effectiveIsGM;
    
    // NEW: Can attempt network breach?
    const canBreachNetwork = hasCharacter && 
                            networkBlocked && 
                            !effectiveGmViewAllMode &&
                            !effectiveIsGM;
    
    // ========================================================================
    // LOGIN DATA
    // ========================================================================
    const loginUsername = this.item.getFlag(MODULE_ID, 'loginUsername') || 'admin';
    const loginDisplayName = this.item.getFlag(MODULE_ID, 'loginDisplayName') || '';
    const loginAttempts = this.item.getFlag(MODULE_ID, 'loginAttempts') || 0;
    const maxLoginAttempts = this.item.getFlag(MODULE_ID, 'maxLoginAttempts') || 5;
    const loginLockoutUntil = this.item.getFlag(MODULE_ID, 'loginLockoutUntil');
    const isLoginLockedOut = loginLockoutUntil && Date.now() < new Date(loginLockoutUntil).getTime();
    const loginLockoutMinutes = isLoginLockedOut 
      ? Math.ceil((new Date(loginLockoutUntil).getTime() - Date.now()) / 60000)
      : 0;
    
    // ========================================================================
    // RETURN COMPLETE DATA
    // ========================================================================
    return {
      ...data,
      
      // Item info
      item: this.item,
      itemName: this.item.name,
      itemId: this.item.id,
      itemDescription: this.item.system.description || '',
      
      // Configuration
      encrypted,
      encryptionDC,
      encryptionType,
      encryptionMode,
      failureMode,
      theme,
      isSingleMode: dataShardType === 'single',
      
      // Network Layer
      networkCheck,
      networkBlocked,
      networkOverride,
      currentNetwork: networkCheck.currentNetwork,
      requiredNetwork: networkCheck.requiredNetwork,
      signalStrength: networkCheck.signalStrength || 100,
      networkInfo: networkCheck.required ? this.networkService.getNetworkInfo(networkCheck.requiredNetwork) : null,
      canBreachNetwork, // NEW
      
      // Login Layer
      requiresLogin,
      sessionLoggedIn,
      loginBlocked,
      loginUsername,
      loginDisplayName, 
      loginAttempts,
      maxLoginAttempts,
      isLoginLockedOut,
      loginLockoutMinutes,
      
      // Encryption Layer
      isActuallyDecrypted,
      encryptionBlocked,
      isShardDecrypted: isActuallyDecrypted,
      
      // Active Overlay
      activeOverlay,
      showNetworkOverlay: activeOverlay === 'network',
      showLoginOverlay: activeOverlay === 'login',
      showShardEncryptedOverlay: activeOverlay === 'encryption',
      
      // Lockout
      isLockedOut,
      lockoutMinutes,
      
      // Access control
      canHackShard,
      canAccessInbox,
      
      // Messages
      messages,
      messageCount: messages.length,
      selectedMessage,
      hasMessages: messages.length > 0,
      
      // Hack data
      previousAttempts,
      maxAttempts,
      selectedActor,
      
      // Permissions
      isOwner: this.item.isOwner,
      isGM: game.user.isGM,
      canAddMessage: this.item.isOwner || game.user.isGM,
      
      // NEW: GM view modes
      gmViewMode: effectiveGmViewAllMode || false,
      gmViewAsPlayer: gmViewAsPlayer || false,
      
      // Encryption mode info
      allowsPerMessageEncryption: encryptionMode === 'message' || encryptionMode === 'both',
      usesShardEncryption: encryptionMode === 'shard' || encryptionMode === 'both',
      usesBothLayers: encryptionMode === 'both'
    };
  }
  
  /**
   * Activate listeners
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Regular actions
    html.find('[data-action="select-message"]').click(this._onMessageSelect.bind(this));
    html.find('[data-action="attempt-hack"]').click(this._onHackAttempt.bind(this));
    html.find('[data-action="add-message"]').click(this._onAddMessage.bind(this));
    html.find('[data-action="share-message"]').click(this._onShareMessage.bind(this));
    html.find('[data-action="delete-message"]').click(this._onDeleteMessage.bind(this));
    html.find('[data-action="configure"]').click(this._onConfigure.bind(this));
    html.find('[data-action="close"]').click(() => this.close());
    html.find('[data-action="add-sender-to-contacts"]').on('click', async (e) => {
      const senderEmail = $(e.currentTarget).data('sender-email');
      const senderName = $(e.currentTarget).data('sender-name');
      await this._addSenderToContacts(senderEmail, senderName);
    });
    
    // GM Controls
    html.find('[data-action="gm-force-decrypt"]').click(this._onGMForceDecrypt.bind(this));
    html.find('[data-action="gm-reset-encryption"]').click(this._onGMResetEncryption.bind(this));
    html.find('[data-action="gm-reset-attempts"]').click(this._onGMResetAttempts.bind(this));
    html.find('[data-action="gm-view-all"]').click(this._onGMViewAll.bind(this));
    html.find('[data-action="gm-view-as-player"]').click(this._onGMViewAsPlayer.bind(this));

    // Network Controls
    html.find('[data-action="switch-network"]').click(this._onSwitchNetwork.bind(this));
    html.find('[data-action="gm-override-network"]').click(this._onGMOverrideNetwork.bind(this));
    html.find('[data-action="attempt-breach-network"]').click(this._onAttemptBreachNetwork.bind(this));

    // Login Controls
    html.find('[data-action="login"]').click(this._onLogin.bind(this));
    html.find('[data-action="attempt-breach-login"]').click(this._onAttemptBreachLogin.bind(this));
    html.find('[data-action="gm-bypass-login"]').click(this._onGMBypassLogin.bind(this));
    
    // Other existing actions
    html.find('[data-action="quarantine-message"]').click(this._onQuarantineMessage.bind(this));
    html.find('[data-action="decrypt-message"]').click(this._onDecryptMessage.bind(this));
  }
  
  // ========================================================================
  // EVENT HANDLERS
  // ========================================================================

  /**
   * Handle message selection
   * @private
   */
  async _onMessageSelect(event) {
    event.preventDefault();
    const messageId = $(event.currentTarget).data('message-id');
    
    console.log(`${MODULE_ID} | Message selected: ${messageId}`);
    
    this.selectedMessageId = messageId;
    this.render(false);
  }
  
  /**
   * Handle hack attempt
   * @private
   */
  async _onHackAttempt(event) {
    event.preventDefault();
    
    const actor = game.user.character;
    if (!actor) {
      ui.notifications.error('You must have a character selected');
      return;
    }
    
    // Get allowed skills and their DVs
    const allowedSkills = this.item.getFlag(MODULE_ID, 'allowedSkills') || ['Interface'];
    const skillDCs = this.item.getFlag(MODULE_ID, 'skillDCs') || { 'Interface': 15 };
    
    // Build skill options array
    const skillOptions = allowedSkills.map(skillName => ({
      skillName,
      dc: skillDCs[skillName] || 15,
      description: skillName === 'Interface' ? 'Netrunning expertise' : 'Technical knowledge'
    }));
    
    // Show skill selection dialog
    const selectedSkill = await game.nightcity.DialogHelper.showSkillSelectionDialog({
      actor,
      skills: skillOptions,
      targetName: this.item.name,
      description: 'Choose which skill to use for this decryption attempt'
    });
    
    if (!selectedSkill) return; // User cancelled
    
    // Show luck dialog
    const luck = await game.nightcity.DialogHelper.showLuckDialog(actor);
    
    if (luck === null) return; // User cancelled
    
    // Deduct luck
    if (luck > 0) {
      const currentLuck = actor.system.stats.luck?.value || 0;
      await actor.update({
        'system.stats.luck.value': currentLuck - luck
      });
    }
    
    // Perform the roll
    const roll = await new Roll('1d10').evaluate({ async: true });
    
    // Get skill and stat values
    const actorSkill = actor.items.find(i => i.type === 'skill' && i.name === selectedSkill.skillName);
    const skillValue = actorSkill?.system?.level || 0;
    
    // Determine stat (simplified)
    const statName = selectedSkill.skillName === 'Interface' ? 'INT' : 'TECH';
    const statValue = actor.system.stats[statName.toLowerCase()]?.value || 0;
    
    const total = roll.total + skillValue + statValue + luck;
    const success = total >= selectedSkill.dc;
    
    // Create beautiful chat message
    await game.nightcity.CyberpunkChatHelper.createDecryptionRollMessage({
      success,
      total,
      diceRoll: roll.total,
      skillValue,
      statValue,
      statName,
      luck,
      dc: selectedSkill.dc,
      skillName: selectedSkill.skillName
    }, actor, roll);
    
    // Handle success/failure
    if (success) {
      await this.item.setFlag(MODULE_ID, 'decrypted', true);
      ui.notifications.info('Decryption successful!');
      this.render(false);
    } else {
      // Handle failure based on failureMode
      const failureMode = this.item.getFlag(MODULE_ID, 'failureMode') || 'lockout';
      
      if (failureMode === 'lockout') {
        const lockoutTime = new Date();
        lockoutTime.setHours(lockoutTime.getHours() + 1);
        await this.item.setFlag(MODULE_ID, 'lockoutUntil', lockoutTime.toISOString());
      } else if (failureMode === 'damage') {
        // BLACK ICE damage
        const damageRoll = await new Roll('3d6').evaluate({ async: true });
        const currentHP = actor.system.hp.value;
        const maxHP = actor.system.hp.max;
        const newHP = Math.max(0, currentHP - damageRoll.total);
        
        await actor.update({ 'system.hp.value': newHP });
        
        await game.nightcity.CyberpunkChatHelper.createBlackICEMessage({
          actor,
          damage: damageRoll.total,
          hp: newHP,
          maxHP,
          shardName: this.item.name
        });
      }
      
      ui.notifications.error('Decryption failed!');
      this.render(false);
    }
  }

  /**
   * Handle decrypt message button (NEW)
   * @private
   */
  async _onDecryptMessage(event) {
    event.preventDefault();
    
    const messageId = $(event.currentTarget).data('message-id');
    if (!messageId) {
      ui.notifications.error('No message ID');
      return;
    }
    
    const message = this.messages.find(m => m.id === messageId);
    if (!message) {
      ui.notifications.error('Message not found');
      return;
    }
    
    const actor = game.user.character;
    if (!actor) {
      ui.notifications.error('You must have a character selected to decrypt');
      return;
    }
    
    // Get encryption info
    const encryption = message.encryption;
    if (!encryption) {
      ui.notifications.info('Message is not encrypted');
      return;
    }
    
    // Confirm the attempt
    const confirmed = await Dialog.confirm({
      title: "Decrypt Message",
      content: `
        <div style="padding: 10px;">
          <p>Attempt to decrypt this message?</p>
          <p><strong>Subject:</strong> ${message.messageData.subject}</p>
          <p><strong>Encryption:</strong> ${encryption.type}</p>
          <p><strong>Difficulty:</strong> DV ${encryption.dc}</p>
          <p><strong>Allowed Skills:</strong> ${encryption.allowedSkills.join(', ')}</p>
          ${encryption.type === 'BLACK_ICE' || encryption.type === 'RED_ICE' ? `
            <div style="background: #330000; border: 2px solid #ff0000; padding: 10px; margin-top: 10px; border-radius: 4px;">
              <p style="color: #ff0000; font-weight: bold; margin: 0;">
                <i class="fas fa-skull"></i> WARNING: BLACK ICE DETECTED
              </p>
              <p style="color: #ffffff; margin: 5px 0 0 0;">
                Failure will trigger lethal countermeasures!
              </p>
            </div>
          ` : ''}
        </div>
      `
    });
    
    if (!confirmed) return;
    
    try {
      // Attempt the decrypt
      const result = await this.dataShardService.attemptMessageDecrypt(message.page, actor);
      
      if (result.success) {
        // Success! Reload messages
        await this._loadMessages();
        ui.notifications.info('Message decrypted successfully!');
      } else if (result.blackICE) {
        ui.notifications.error(`Decryption failed! BLACK ICE dealt ${result.damage} damage!`);
      } else if (!result.cancelled) {
        ui.notifications.error('Decryption failed');
      }
      
      // Refresh view
      this.render(false);
      
    } catch (error) {
      console.error(`${MODULE_ID} | Decrypt attempt error:`, error);
      ui.notifications.error('Decryption attempt failed');
    }
  }
  
  /**
   * Handle add message
   * @private
   */
  async _onAddMessage(event) {
    event.preventDefault();
    
    // Import and open the composer
    const { DataShardMessageComposer } = await import('./DataShardMessageComposer.js');
    
    const composer = new DataShardMessageComposer(this.item, {
      from: game.user.character?.getFlag(MODULE_ID, 'email') || '',
      to: '',
      subject: '',
      content: ''
    });
    
    composer.render(true);
    
    // Use Hooks instead of once()
    const hookId = Hooks.on('closeApplication', (app) => {
      if (app === composer) {
        Hooks.off('closeApplication', hookId);
        this._loadMessages().then(() => {
          this.render(false);
        });
      }
    });
  }

  /**
   * Add message sender to player's personal contacts
   */
  async _addSenderToContacts(email, name) {
    if (!email) {
      ui.notifications.warn('No sender email available');
      return;
    }
    
    // Check if already in contacts
    const contacts = await game.user.getFlag(MODULE_ID, 'contacts') || [];
    const exists = contacts.find(c => c.email === email);
    
    if (exists) {
      ui.notifications.info(`${name || email} is already in your contacts`);
      return;
    }
    
    // Add to contacts
    contacts.push({
      id: foundry.utils.randomID(),
      name: name || email,
      email: email,
      type: 'discovered',
      tags: ['data-shard'],
      notes: 'Added from data shard',
      createdAt: new Date().toISOString()
    });
    
    await game.user.setFlag(MODULE_ID, 'contacts', contacts);
    
    ui.notifications.info(`Added ${name || email} to your contacts`);
    this.playSound('notification');
  }
  
  /**
   * Handle share message
   * @private
   */
  async _onShareMessage(event) {
    event.preventDefault();
    
    if (!this.selectedMessageId) {
      ui.notifications.warn('No message selected');
      return;
    }
    
    const message = this.messages.find(m => m.id === this.selectedMessageId);
    if (!message) return;
    
    // Share to chat
    await this._shareToChat(message);
  }
  
  /**
   * Handle delete message
   * @private
   */
  async _onDeleteMessage(event) {
    event.preventDefault();
    
    if (!this.selectedMessageId) {
      ui.notifications.warn('No message selected');
      return;
    }
    
    const confirmed = await Dialog.confirm({
      title: "Delete Message",
      content: "<p>Are you sure you want to delete this message?</p>"
    });
    
    if (!confirmed) return;
    
    try {
      const message = this.messages.find(m => m.id === this.selectedMessageId);
      if (message && message.page) {
        await message.page.delete();
        await this._loadMessages();
        this.selectedMessageId = null;
        this.render(false);
        ui.notifications.info('Message deleted');
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error deleting message:`, error);
      ui.notifications.error('Failed to delete message');
    }
  }
  
  /**
   * Handle configure
   * @private
   */
  async _onConfigure(event) {
    event.preventDefault();
    
    // Import and open config dialog
    const { ItemInboxConfig } = await import('./ItemInboxConfig.js');
    new ItemInboxConfig(this.item, { parent: this }).render(true);
  }

  _applyLayoutMode(html) {
    const dataShardType = this.item.getFlag(MODULE_ID, 'dataShardType') || 'multi';
    const contentEl = html.find('.ncm-item-inbox__content');
    
    if (dataShardType === 'single') {
      contentEl.addClass('single-mode');
    } else {
      contentEl.removeClass('single-mode');
    }
  }
  
  /**
   * GM: Force decrypt the data shard (bypass encryption)
   * @private
   */
  async _onGMForceDecrypt(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.error('Only GMs can force decrypt');
      return;
    }
    
    const confirmed = await Dialog.confirm({
      title: "Force Decrypt Data Shard",
      content: `
        <p>Bypass encryption and unlock this data shard?</p>
        <p><strong>This is a GM override.</strong></p>
        <p>Players will see the shard as decrypted.</p>
      `
    });
    
    if (!confirmed) return;
    
    try {
      // Set the decrypted flag
      await this.item.setFlag(MODULE_ID, 'decrypted', true);
      
      // Clear lockout
      await this.item.unsetFlag(MODULE_ID, 'lockoutUntil');
      
      // Reset hack attempts
      await this.item.setFlag(MODULE_ID, 'hackAttempts', 0);
      
      // Reload messages
      await this._loadMessages();
      
      // Re-render
      this.render(false);
      
      // Notification
      ui.notifications.info('GM Override: Data shard decrypted');
      
      // Create chat message
      await ChatMessage.create({
        content: `
          <div style="background: rgba(255, 215, 0, 0.1); border: 1px solid #FFD700; padding: 10px; border-radius: 4px;">
            <p><strong style="color: #FFD700;"><i class="fas fa-crown"></i> GM OVERRIDE</strong></p>
            <p>Data shard <strong>${this.item.name}</strong> was force-decrypted.</p>
          </div>
        `,
        whisper: [game.user.id]
      });
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error force decrypting:`, error);
      ui.notifications.error('Failed to force decrypt');
    }
  }
  
  /**
   * Handle quarantine message (NEW)
   * @private
   */
  async _onQuarantineMessage(event) {
    event.preventDefault();
    
    if (!this.selectedMessageId) return;
    
    const message = this.messages.find(m => m.id === this.selectedMessageId);
    if (!message || !message.page) return;
    
    // Update message data
    const messageData = message.messageData;
    messageData.quarantined = true;
    
    await message.page.setFlag(MODULE_ID, 'messageData', messageData);
    await this._loadMessages();
    this.render(false);
    
    ui.notifications.info('Message quarantined');
  }

  // ========================================================================
  // NETWORK EVENT HANDLERS
  // ========================================================================
  
  /**
   * Switch networks (future: skill check required)
   * @private
   */
  async _onSwitchNetwork(event) {
    event.preventDefault();
    
    const requiredNetwork = this.item.getFlag(MODULE_ID, 'requiredNetwork');
    
    // Show network selection dialog
    const networks = this.networkService.getAvailableNetworks();
    
    const buttons = {};
    for (const network of networks) {
      buttons[network.name] = {
        label: network.displayName,
        icon: `<i class="${network.icon}"></i>`,
        callback: () => network.name
      };
    }
    
    const selectedNetwork = await Dialog.wait({
      title: "Switch Network",
      content: `
        <div style="margin-bottom: 15px;">
          <p><strong>Required:</strong> ${requiredNetwork}</p>
          <p>Select a network to connect to:</p>
        </div>
      `,
      buttons,
      default: requiredNetwork
    });
    
    if (selectedNetwork) {
      await this.networkService.attemptNetworkSwitch(selectedNetwork);
      this.render(false);
    }
  }
  
  /**
   * GM override network requirement
   * @private
   */
  async _onGMOverrideNetwork(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.error('Only GMs can override network requirements');
      return;
    }
    
    await this.item.setFlag(MODULE_ID, 'networkOverride', true);
    this.render(false);
    ui.notifications.info('GM Override: Network requirement bypassed');
    
    await ChatMessage.create({
      content: `
        <div style="background: rgba(255, 215, 0, 0.1); border: 1px solid #FFD700; padding: 10px; border-radius: 4px;">
          <p><strong style="color: #FFD700;"><i class="fas fa-crown"></i> GM OVERRIDE</strong></p>
          <p>Network requirement bypassed for <strong>${this.item.name}</strong>.</p>
        </div>
      `,
      whisper: [game.user.id]
    });
  }

  /**
   * Attempt to breach network requirement via hacking
   * @private
   */
  async _onAttemptBreachNetwork(event) {
    event.preventDefault();
    
    const actor = game.user.character;
    if (!actor) {
      ui.notifications.error('You must have a character selected to breach network security');
      return;
    }
    
    const requiredNetwork = this.item.getFlag(MODULE_ID, 'requiredNetwork');
    const currentNetwork = this.networkService.getCurrentNetwork();
    
    // Calculate difficulty based on network type
    const networkDCs = {
      'CITINET': 13,      // Public network - easier
      'CORPNET': 17,      // Corporate - harder
      'DARKNET': 15,      // Underground - moderate
      'DEAD_ZONE': 21     // No network - very hard
    };
    
    const dc = networkDCs[requiredNetwork] || 15;
    
    // Show confirmation
    const confirmed = await Dialog.confirm({
      title: "Breach Network Security",
      content: `
        <div style="font-family: 'Rajdhani', sans-serif; padding: 10px;">
          <h3 style="color: var(--ncm-primary); margin: 0 0 15px 0;">
            <i class="fas fa-network-wired"></i> Network Breach Attempt
          </h3>
          
          <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 4px; margin-bottom: 15px;">
            <p><strong>Target:</strong> ${this.item.name}</p>
            <p><strong>Current Network:</strong> <span style="color: var(--ncm-error);">${currentNetwork}</span></p>
            <p><strong>Required Network:</strong> <span style="color: var(--ncm-warning);">${requiredNetwork}</span></p>
            <p><strong>Action:</strong> Spoof network credentials</p>
          </div>
          
          <div style="background: rgba(25, 243, 247, 0.1); padding: 15px; border-radius: 4px; border: 1px solid var(--ncm-secondary);">
            <p><strong style="color: var(--ncm-secondary);">Skill Check Required:</strong></p>
            <p>Interface or Electronics/Security Tech</p>
            <p><strong>Difficulty:</strong> DV ${dc}</p>
          </div>
          
          <p style="color: var(--ncm-text-dim); font-size: 0.9em; margin: 15px 0 0 0; font-style: italic;">
            <i class="fas fa-info-circle"></i> Success will temporarily bypass the network requirement.
          </p>
        </div>
      `
    });
    
    if (!confirmed) return;
    
    // Perform skill check
    const result = await this.skillService.performCheck({
      actor,
      skills: ['Interface', 'Electronics/Security Tech', 'Basic Tech'],
      dc,
      taskName: `Breaching ${requiredNetwork}`,
      allowLuck: true,
      autoRoll: false
    });
    
    if (result.cancelled) return;
    
    if (result.success) {
      // Success! Set network override flag
      await this.item.setFlag(MODULE_ID, 'networkOverride', true);
      
      this.render(false);
      ui.notifications.info(`Network breach successful! Access granted to ${requiredNetwork}.`);
      
      await ChatMessage.create({
        content: `
          <div style="background: rgba(25, 243, 247, 0.1); border: 2px solid var(--ncm-secondary); padding: 15px; border-radius: 4px;">
            <p style="font-weight: bold; color: var(--ncm-secondary); margin-bottom: 8px;">
              <i class="fas fa-network-wired"></i> NETWORK BREACH SUCCESSFUL
            </p>
            <p style="margin: 0;">
              <strong>${actor.name}</strong> spoofed <strong>${requiredNetwork}</strong> credentials
            </p>
            <p style="margin: 5px 0 0 0; color: var(--ncm-text-dim); font-size: 0.9em;">
              Target: ${this.item.name} • Roll: ${result.total} vs DV ${dc}
            </p>
          </div>
        `,
        speaker: ChatMessage.getSpeaker({ actor }),
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });
      
    } else {
      // Failed
      ui.notifications.error('Network breach failed! Access denied.');
      
      await ChatMessage.create({
        content: `
          <div style="background: rgba(246, 82, 97, 0.1); border: 2px solid var(--ncm-primary); padding: 15px; border-radius: 4px;">
            <p style="font-weight: bold; color: var(--ncm-primary); margin-bottom: 8px;">
              <i class="fas fa-times-circle"></i> NETWORK BREACH FAILED
            </p>
            <p style="margin: 0;">
              <strong>${actor.name}</strong> failed to breach <strong>${requiredNetwork}</strong>
            </p>
            <p style="margin: 5px 0 0 0; color: var(--ncm-text-dim); font-size: 0.9em;">
              Target: ${this.item.name} • Roll: ${result.total} vs DV ${dc}
            </p>
            <p style="margin: 8px 0 0 0; color: var(--ncm-warning); font-size: 0.9em;">
              <i class="fas fa-exclamation-triangle"></i> Trace initiated - NetWatch may be alerted
            </p>
          </div>
        `,
        speaker: ChatMessage.getSpeaker({ actor }),
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });
    }
  }

  
    // ========================================================================
  // LOGIN EVENT HANDLERS
  // ========================================================================
  
  /**
   * Handle login attempt
   * @private
   */
  async _onLogin(event) {
    event.preventDefault();
    
    const form = $(event.currentTarget).closest('form');
    const username = form.find('input[name="username"]').val()?.trim();
    const password = form.find('input[name="password"]').val();
    
    // Check lockout
    const loginLockoutUntil = this.item.getFlag(MODULE_ID, 'loginLockoutUntil');
    if (loginLockoutUntil && Date.now() < new Date(loginLockoutUntil).getTime()) {
      const remaining = Math.ceil((new Date(loginLockoutUntil).getTime() - Date.now()) / 60000);
      ui.notifications.error(`Login locked out for ${remaining} more minutes`);
      return;
    }
    
    // Validate
    if (!username || !password) {
      ui.notifications.error('Please enter both username and password');
      return;
    }
    
    const savedUsername = this.item.getFlag(MODULE_ID, 'loginUsername');
    const savedPassword = this.item.getFlag(MODULE_ID, 'loginPassword');
    
    console.log(`${MODULE_ID} | Login attempt - Username: ${username}`);
    
    if (username === savedUsername && password === savedPassword) {
      // Success!
      await this.item.setFlag(MODULE_ID, 'sessionLoggedIn', true);
      await this.item.setFlag(MODULE_ID, 'loginAttempts', 0);
      
      this.render(false);
      ui.notifications.info('Login successful!');
      
      await ChatMessage.create({
        content: `
          <div style="background: rgba(25, 243, 247, 0.1); border: 1px solid #19f3f7; padding: 10px; border-radius: 4px;">
            <p><strong style="color: #19f3f7;"><i class="fas fa-unlock"></i> ACCESS GRANTED</strong></p>
            <p><strong>${game.user.character?.name || game.user.name}</strong> logged into <strong>${this.item.name}</strong></p>
          </div>
        `,
        speaker: ChatMessage.getSpeaker({ actor: game.user.character })
      });
      
    } else {
      // Failed login
      const loginAttempts = (this.item.getFlag(MODULE_ID, 'loginAttempts') || 0) + 1;
      const maxLoginAttempts = this.item.getFlag(MODULE_ID, 'maxLoginAttempts') || 5;
      
      await this.item.setFlag(MODULE_ID, 'loginAttempts', loginAttempts);
      
      // Check if locked out
      if (loginAttempts >= maxLoginAttempts) {
        const lockoutDuration = 3600000; // 1 hour
        const lockoutUntil = Date.now() + lockoutDuration;
        await this.item.setFlag(MODULE_ID, 'loginLockoutUntil', lockoutUntil);
        
        ui.notifications.error(`Too many failed attempts! Locked out for 1 hour.`);
        
        await ChatMessage.create({
          content: `
            <div style="background: rgba(246, 82, 97, 0.1); border: 1px solid #F65261; padding: 10px; border-radius: 4px;">
              <p><strong style="color: #F65261;"><i class="fas fa-exclamation-triangle"></i> SECURITY ALERT</strong></p>
              <p><strong>${game.user.character?.name || game.user.name}</strong> triggered login lockout on <strong>${this.item.name}</strong></p>
            </div>
          `,
          speaker: ChatMessage.getSpeaker({ actor: game.user.character })
        });
      } else {
        ui.notifications.error(`Incorrect credentials. ${maxLoginAttempts - loginAttempts} attempts remaining.`);
      }
      
      this.render(false);
    }
  }
  
  /**
   * Attempt breach (bypass login via hacking)
   * @private
   */
  async _onAttemptBreachLogin(event) {
    event.preventDefault();
    
    const actor = game.user.character;
    if (!actor) {
      ui.notifications.error('You must have a character selected to breach security');
      return;
    }
    
    // ========================================================================
    // NEW: Get allowed breach skills and their DVs
    // ========================================================================
    const breachSkills = ['Interface', 'Electronics/Security Tech'];
    const breachDC = 15; // Could make this configurable
    
    // Build skill options array
    const skillOptions = breachSkills.map(skillName => {
      const actorSkill = actor.items.find(i => i.type === 'skill' && i.name === skillName);
      return {
        skillName,
        dc: breachDC,
        description: skillName === 'Interface' 
          ? 'Use netrunning to bypass authentication'
          : 'Exploit hardware vulnerabilities'
      };
    }).filter(opt => {
      // Only include skills the actor has
      const actorSkill = actor.items.find(i => i.type === 'skill' && i.name === opt.skillName);
      return actorSkill && actorSkill.system.level > 0;
    });
    
    if (skillOptions.length === 0) {
      ui.notifications.error('You do not have the required skills to breach this system');
      return;
    }
    
    // Show styled skill selection dialog
    const selectedSkill = await game.nightcity.DialogHelper.showSkillSelectionDialog({
      actor,
      skills: skillOptions,
      targetName: this.item.name,
      description: 'Choose your approach to bypass the authentication system. This is a risky operation!'
    });
    
    if (!selectedSkill) return; // User cancelled
    
    // Show luck dialog
    const luck = await game.nightcity.DialogHelper.showLuckDialog(actor);
    
    if (luck === null) return; // User cancelled
    
    // Deduct luck
    if (luck > 0) {
      const currentLuck = actor.system.stats.luck?.value || 0;
      await actor.update({
        'system.stats.luck.value': currentLuck - luck
      });
    }
    
    // Perform the roll
    const roll = await new Roll('1d10').evaluate({ async: true });
    
    // Get skill and stat values
    const actorSkill = actor.items.find(i => i.type === 'skill' && i.name === selectedSkill.skillName);
    const skillValue = actorSkill?.system?.level || 0;
    
    // Determine stat
    const statName = selectedSkill.skillName === 'Interface' ? 'INT' : 'TECH';
    const statValue = actor.system.stats[statName.toLowerCase()]?.value || 0;
    
    const total = roll.total + skillValue + statValue + luck;
    const success = total >= selectedSkill.dc;
    
    // Create beautiful chat message using CyberpunkChatHelper
    await game.nightcity.CyberpunkChatHelper.createNetworkBreachMessage({
      success,
      total,
      diceRoll: roll.total,
      skillValue,
      statValue,
      statName,
      luck,
      dc: selectedSkill.dc,
      skillName: selectedSkill.skillName,
      targetName: this.item.name
    }, actor, roll);
    
    // Handle success/failure
    if (success) {
      // Successfully breached!
      await this.item.setFlag(MODULE_ID, 'sessionLoggedIn', true);
      await this.item.setFlag(MODULE_ID, 'loginAttempts', 0);
      
      this.render(false);
      ui.notifications.info('Security breached! Access granted.');
      
    } else {
      // Failed breach - increment attempt counter
      const loginAttempts = this.item.getFlag(MODULE_ID, 'loginAttempts') || 0;
      await this.item.setFlag(MODULE_ID, 'loginAttempts', loginAttempts + 1);
      
      const maxLoginAttempts = this.item.getFlag(MODULE_ID, 'maxLoginAttempts') || 5;
      
      if (loginAttempts + 1 >= maxLoginAttempts) {
        // Lock out the user
        const lockoutTime = new Date();
        lockoutTime.setHours(lockoutTime.getHours() + 1);
        await this.item.setFlag(MODULE_ID, 'loginLockoutUntil', lockoutTime.toISOString());
        
        ui.notifications.error('Security breach failed! System locked for 1 hour.');
      } else {
        ui.notifications.error(`Breach attempt failed! ${maxLoginAttempts - (loginAttempts + 1)} attempts remaining.`);
      }
      
      this.render(false);
    }
  }
  
  /**
   * GM bypass login
   * @private
   */
  async _onGMBypassLogin(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.error('Only GMs can bypass login');
      return;
    }
    
    await this.item.setFlag(MODULE_ID, 'sessionLoggedIn', true);
    this.render(false);
    ui.notifications.info('GM Override: Login bypassed');
    
    await ChatMessage.create({
      content: `
        <div style="background: rgba(255, 215, 0, 0.1); border: 1px solid #FFD700; padding: 10px; border-radius: 4px;">
          <p><strong style="color: #FFD700;"><i class="fas fa-crown"></i> GM OVERRIDE</strong></p>
          <p>Login bypassed for <strong>${this.item.name}</strong>.</p>
        </div>
      `,
      whisper: [game.user.id]
    });
  }

  // ========================================================================
  // GM Methods
  // ========================================================================

  /**
   * GM: Re-lock the shard (reset encryption)
   * @private
   */
  async _onGMResetEncryption(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.error('Only GMs can reset encryption');
      return;
    }
    
    // Get current configuration to show relevant options
    const hasEncryption = this.item.getFlag(MODULE_ID, 'encrypted');
    const hasNetworkReq = this.item.getFlag(MODULE_ID, 'requiresNetwork');
    const hasLogin = this.item.getFlag(MODULE_ID, 'requiresLogin');
    const requiredNetwork = this.item.getFlag(MODULE_ID, 'requiredNetwork') || 'CITINET';
    
    // Show options dialog
    const content = await renderTemplate(
      'modules/cyberpunkred-messenger/templates/dialogs/relock-options.hbs',
      {
        itemName: this.item.name,
        hasEncryption,
        hasNetworkReq,
        hasLogin,
        requiredNetwork
      }
    );
    
    const result = await Dialog.prompt({
      title: "Re-Lock Data Shard",
      content: content,
      callback: (html) => {
        return {
          encryption: html.find('[name="reset-encryption"]').is(':checked'),
          network: html.find('[name="reset-network"]').is(':checked'),
          login: html.find('[name="reset-login"]').is(':checked'),
          attempts: html.find('[name="reset-attempts"]').is(':checked'),
          lockouts: html.find('[name="reset-lockouts"]').is(':checked')
        };
      },
      rejectClose: false,
      options: { width: 450 }
    });
    
    if (!result) return;
    
    try {
      const resetActions = [];
      
      // ========================================================================
      // ENCRYPTION LAYER
      // ========================================================================
      if (result.encryption && hasEncryption) {
        await this.item.setFlag(MODULE_ID, 'decrypted', false);
        const storageKey = `${MODULE_ID}-decrypted-${this.item.id}`;
        localStorage.removeItem(storageKey);
        resetActions.push('🔒 Encryption: <span style="color: #F65261;">LOCKED</span>');
      }
      
      // ========================================================================
      // NETWORK LAYER
      // ========================================================================
      if (result.network && hasNetworkReq) {
        await this.item.unsetFlag(MODULE_ID, 'networkOverride');
        resetActions.push('🌐 Network Override: <span style="color: #F65261;">CLEARED</span>');
      }
      
      // ========================================================================
      // LOGIN LAYER
      // ========================================================================
      if (result.login && hasLogin) {
        await this.item.unsetFlag(MODULE_ID, 'sessionLoggedIn');
        resetActions.push('👤 Login Session: <span style="color: #F65261;">CLEARED</span>');
      }
      
      // ========================================================================
      // ATTEMPTS (applies to both encryption and login)
      // ========================================================================
      if (result.attempts) {
        await this.item.setFlag(MODULE_ID, 'hackAttempts', 0);
        await this.item.setFlag(MODULE_ID, 'loginAttempts', 0);
        resetActions.push('🔄 Hack Attempts: <span style="color: #F65261;">RESET TO 0</span>');
      }
      
      // ========================================================================
      // LOCKOUTS (applies to both encryption and login)
      // ========================================================================
      if (result.lockouts) {
        await this.item.unsetFlag(MODULE_ID, 'lockoutUntil');
        await this.item.unsetFlag(MODULE_ID, 'loginLockoutUntil');
        resetActions.push('⏱️ Lockout Timers: <span style="color: #F65261;">CLEARED</span>');
      }
      
      // ========================================================================
      // RE-RENDER & NOTIFY
      // ========================================================================
      this.render(false);
      
      if (resetActions.length > 0) {
        ui.notifications.info(`GM Override: ${resetActions.length} security layer(s) reset`);
        
        // Create detailed chat message
        await ChatMessage.create({
          content: `
            <div style="background: rgba(255, 215, 0, 0.1); border: 1px solid #FFD700; padding: 15px; border-radius: 4px; font-family: 'Rajdhani', sans-serif;">
              <p style="margin: 0 0 10px 0;"><strong style="color: #FFD700; font-size: 1.1em;"><i class="fas fa-crown"></i> GM OVERRIDE</strong></p>
              <p style="margin: 0 0 10px 0;">Security reset for <strong>${this.item.name}</strong>:</p>
              
              <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 4px; margin: 10px 0;">
                <ul style="margin: 0; padding-left: 20px; list-style: none;">
                  ${resetActions.map(action => `<li style="margin: 5px 0;">${action}</li>`).join('')}
                </ul>
              </div>
              
              <p style="color: rgba(255, 255, 255, 0.6); font-size: 0.9em; margin: 10px 0 0 0; font-style: italic;">
                Players must bypass these security layers again to access the shard.
              </p>
            </div>
          `,
          whisper: [game.user.id]
        });
      } else {
        ui.notifications.warn('No security layers were reset');
      }
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error resetting data shard:`, error);
      ui.notifications.error('Failed to reset data shard');
    }
  }

  /**
   * GM: Reset failed hack attempts counter
   * @private
   */
  async _onGMResetAttempts(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.error('Only GMs can reset hack attempts');
      return;
    }
    
    const confirmed = await Dialog.confirm({
      title: "Reset Hack Attempts",
      content: `
        <p>Reset the hack attempt counter for this data shard?</p>
        <p>This will also clear any lockout timer.</p>
      `
    });
    
    if (!confirmed) return;
    
    try {
      // Reset hack attempts
      await this.item.setFlag(MODULE_ID, 'hackAttempts', 0);
      
      // Clear lockout
      await this.item.unsetFlag(MODULE_ID, 'lockoutUntil');
      
      // Re-render
      this.render(false);
      
      // Notification
      ui.notifications.info('GM Override: Hack attempts reset');
      
      // Create chat message
      await ChatMessage.create({
        content: `
          <div style="background: rgba(255, 215, 0, 0.1); border: 1px solid #FFD700; padding: 10px; border-radius: 4px;">
            <p><strong style="color: #FFD700;"><i class="fas fa-crown"></i> GM OVERRIDE</strong></p>
            <p>Hack attempts reset for <strong>${this.item.name}</strong>.</p>
          </div>
        `,
        whisper: [game.user.id]
      });
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error resetting attempts:`, error);
      ui.notifications.error('Failed to reset hack attempts');
    }
  }

  /**
   * GM: Toggle "view as player" mode
   * @private
   */
  async _onGMViewAsPlayer(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.error('Only GMs can toggle view as player mode');
      return;
    }
    
    // Toggle the mode
    this.gmViewAsPlayer = !this.gmViewAsPlayer;
    
    // If enabling "view as player", disable "view all"
    if (this.gmViewAsPlayer) {
      this.gmViewAllMode = false;
    }
    
    // Re-render
    this.render(false);
    
    // Notification
    if (this.gmViewAsPlayer) {
      ui.notifications.info('GM Mode: Viewing as Player (experiencing all security layers)');
    } else {
      ui.notifications.info('GM Mode: Normal (can bypass security)');
    }
  }

  /**
   * GM: Toggle "view all" mode (existing method - update it)
   * @private
   */
  async _onGMViewAll(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.error('Only GMs can use view all mode');
      return;
    }
    
    // Toggle the GM view mode
    this.gmViewAllMode = !this.gmViewAllMode;
    
    // If enabling "view all", disable "view as player"
    if (this.gmViewAllMode) {
      this.gmViewAsPlayer = false;
    }
    
    // Re-render to show/hide content based on mode
    this.render(false);
    
    // Notification
    if (this.gmViewAllMode) {
      ui.notifications.info('GM View All: Enabled (ignoring encryption)');
    } else {
      ui.notifications.info('GM View All: Disabled (respecting encryption)');
    }
  }

  
  // ========================================================================
  // HELPER METHODS
  // ========================================================================
  
  /**
   * Load messages from data shard
   * @private
   */
  async _loadMessages() {
    try {
      this.messages = await this.dataShardService.getMessages(this.item);
      
      console.log(`${MODULE_ID} | Loaded ${this.messages.length} messages`);
      
      // Auto-select first message in single mode if none selected
      const dataShardType = this.item.getFlag(MODULE_ID, 'dataShardType') || 'single';
      if (dataShardType === 'single' && this.messages.length > 0 && !this.selectedMessageId) {
        this.selectedMessageId = this.messages[0].id;
      }
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading messages:`, error);
      this.messages = [];
    }
  }
  
  /**
   * Record hack attempt (NEW)
   * @private
   */
  async _recordHackAttempt(actor, success, roll) {
    const attempts = this.item.getFlag(MODULE_ID, 'hackAttempts') || [];
    attempts.push({
      actorName: actor.name,
      actorId: actor.id,
      result: success ? 'Success' : 'Failure',
      roll: roll || 0,
      timestamp: new Date().toISOString()
    });
    
    await this.item.setFlag(MODULE_ID, 'hackAttempts', attempts);
  }
  
  /**
   * Share message to chat
   * @private
   */
  async _shareToChat(message) {
    const content = `
      <div class="ncm-shared-data-shard-message">
        <header>
          <i class="fas fa-microchip"></i>
          DATA SHARD CONTENTS
        </header>
        <div class="ncm-message-info">
          <div class="ncm-shard-name">${this.item.name}</div>
          <div class="ncm-message-subject">${message.messageData.subject}</div>
        </div>
        <div class="ncm-message-meta">
          <span>FROM: ${message.messageData.from}</span>
          <span>TO: ${message.messageData.to}</span>
          <span>DATE: ${message.messageData.date}</span>
        </div>
        <div class="ncm-message-content">
          ${message.content}
        </div>
        <div class="ncm-message-actions">
          <button class="ncm-view-data-shard" data-item-id="${this.item.id}" data-message-id="${message.id}">
            <i class="fas fa-eye"></i> View Data Shard
          </button>
        </div>
      </div>
    `;
    
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker(),
      flags: {
        [MODULE_ID]: {
          sharedDataShard: true,
          itemId: this.item.id,
          messageId: message.id
        }
      }
    });
    
    ui.notifications.info('Message shared to chat');
  }
  
  /**
   * Setup event listeners
   * @private
   */
  _setupEvents() {
    // Listen for data shard updates
    this.eventBus.on(EVENTS.DATA_SHARD_MESSAGE_ADDED, async (data) => {
      if (data.item.id === this.item.id) {
        await this._loadMessages();
        this.render(false);
      }
    });
    
    this.eventBus.on(EVENTS.DATA_SHARD_DECRYPTED, async (data) => {
      if (data.item.id === this.item.id) {
        await this._loadMessages();
        this.render(false);
      }
    });
  }
  
  /**
   * Close handler
   */
  async close(options = {}) {
    // Cleanup
    this.eventBus.off(EVENTS.DATA_SHARD_MESSAGE_ADDED);
    this.eventBus.off(EVENTS.DATA_SHARD_DECRYPTED);
    
    return super.close(options);
  }
}