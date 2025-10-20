/**
 * Item Inbox Application (Enhanced)
 * File: scripts/ui/components/ItemInbox/ItemInboxApp.js
 * Module: cyberpunkred-messenger
 * Description: View messages stored in items (data shards)
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';
import { DataShardService } from '../../../services/DataShardService.js';
import { EVENTS, EventBus } from '../../../core/EventBus.js'; 

export class ItemInboxApp extends BaseApplication {
  constructor(item, options = {}) {
    super(options);
    
    this.item = item;
    
    // Check if item is a data shard
    if (!this.item.getFlag(MODULE_ID, 'isDataShard')) {
      ui.notifications.error('This item is not configured as a data shard');
      throw new Error('Item is not a data shard');
    }
    
    // Initialize service
    const eventBus = EventBus.getInstance();
    this.dataShardService = new DataShardService(eventBus);
    
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
      width: 800,
      height: 700,
      resizable: true,
      title: "Data Shard",
      tabs: []
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
   * Get data for template
   */
  async getData(options = {}) {
    const data = await super.getData(options);
    
    // ========================================================================
    // EXISTING: Get item flags
    // ========================================================================
    const encrypted = this.item.getFlag(MODULE_ID, 'encrypted') || false;
    const encryptionDC = this.item.getFlag(MODULE_ID, 'encryptionDC') || 15;
    const encryptionType = this.item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
    const encryptionMode = this.item.getFlag(MODULE_ID, 'encryptionMode') || 'shard'; // NEW
    const failureMode = this.item.getFlag(MODULE_ID, 'failureMode') || 'lockout';
    const theme = this.item.getFlag(MODULE_ID, 'theme') || 'default';
    const dataShardType = this.item.getFlag(MODULE_ID, 'dataShardType') || 'single';
    
    // ========================================================================
    // EXISTING: Network requirements
    // ========================================================================
    const requiresNetwork = this.item.getFlag(MODULE_ID, 'requiresNetwork') || false;
    const requiredNetwork = this.item.getFlag(MODULE_ID, 'requiredNetwork') || 'CITINET';
    const networkAvailable = true; // TODO: Check actual network status
    
    // ========================================================================
    // EXISTING: Login requirements
    // ========================================================================
    const requiresLogin = this.item.getFlag(MODULE_ID, 'requiresLogin') || false;
    const isLoggedIn = this.item.getFlag(MODULE_ID, 'sessionLoggedIn') || false;
    
    // ========================================================================
    // UPDATED: Check if shard is decrypted (for shard-level encryption)
    // ========================================================================
    const shardDecrypted = this.item.getFlag(MODULE_ID, 'decrypted') || false;
    
    // Determine if shard-level encryption is active
    const shardEncryptionActive = encrypted && (encryptionMode === 'shard' || encryptionMode === 'both');
    const isShardDecrypted = shardDecrypted || !shardEncryptionActive || game.user.isGM;
    
    // ========================================================================
    // EXISTING: Check lockout
    // ========================================================================
    const lockoutUntil = this.item.getFlag(MODULE_ID, 'lockoutUntil');
    const isLockedOut = lockoutUntil && Date.now() < lockoutUntil;
    const lockoutMinutes = isLockedOut ? Math.ceil((lockoutUntil - Date.now()) / 1000 / 60) : 0;
    
    // ========================================================================
    // UPDATED: Can access inbox? (considers all security layers)
    // ========================================================================
    const canAccessInbox = (isShardDecrypted || game.user.isGM) && 
                           (!requiresNetwork || networkAvailable || game.user.isGM) &&
                           (!requiresLogin || isLoggedIn || game.user.isGM);
    
    // ========================================================================
    // UPDATED: Get messages with per-message encryption status
    // ========================================================================
    const messages = this.messages.map(msg => {
      // Check if this specific message is encrypted
      const messageEncrypted = msg.messageData?.encrypted || false;
      const messageDecrypted = msg.messageData?.decrypted || false;
      
      // Show lock icon if message is encrypted and not decrypted
      const showLockIcon = messageEncrypted && !messageDecrypted;
      
      // Can decrypt this message?
      const canDecryptMessage = messageEncrypted && !messageDecrypted && game.user.character;
      
      return {
        ...msg,
        isSelected: msg.id === this.selectedMessageId,
        canView: canAccessInbox,
        showLockIcon, // NEW
        canDecrypt: canDecryptMessage // NEW
      };
    });
    
    // ========================================================================
    // UPDATED: Get selected message with encryption overlay logic
    // ========================================================================
    let selectedMessage = null;
    if (this.selectedMessageId) {
      const msg = messages.find(m => m.id === this.selectedMessageId);
      if (msg) {
        // Check if this message is encrypted
        const messageEncrypted = msg.messageData?.encrypted || false;
        const messageDecrypted = msg.messageData?.decrypted || false;
        
        // Show content if: decrypted OR not encrypted OR user is GM
        const showContent = messageDecrypted || !messageEncrypted || game.user.isGM;
        
        // Show encrypted overlay if: encrypted AND not decrypted AND not GM
        const showEncryptedOverlay = messageEncrypted && !messageDecrypted && !game.user.isGM;
        
        // Can decrypt this message?
        const canDecryptMessage = messageEncrypted && !messageDecrypted && game.user.character;
        
        selectedMessage = {
          ...msg,
          messageData: msg.messageData || {},
          content: msg.content || '',
          canView: canAccessInbox,
          attachments: msg.attachments || [],
          infected: msg.messageData?.infected || false,
          malwareType: msg.messageData?.malwareType || null,
          threatLevel: msg.messageData?.threatLevel || 'unknown',
          
          // NEW: Per-message encryption status
          showContent, // Whether to show the actual content
          showEncryptedOverlay, // Whether to show "ENCRYPTED" overlay
          canDecrypt: canDecryptMessage, // Whether to show decrypt button
          encryption: msg.encryption || null // Encryption settings
        };
      }
    }
    
    // ========================================================================
    // UPDATED: Check if user can attempt shard-level hack
    // ========================================================================
    const canHackShard = game.user.character && 
                         !isShardDecrypted && 
                         !isLockedOut && 
                         shardEncryptionActive;
    
    const selectedActor = game.user.character;
    
    // ========================================================================
    // UPDATED: Show shard encrypted overlay?
    // ========================================================================
    const showShardEncryptedOverlay = shardEncryptionActive && 
                                      !isShardDecrypted && 
                                      !game.user.isGM;
    
    // ========================================================================
    // EXISTING: Previous hack attempts
    // ========================================================================
    const previousAttempts = this.item.getFlag(MODULE_ID, 'hackAttempts') || [];
    
    // ========================================================================
    // RETURN: Complete data object
    // ========================================================================
    return {
      ...data,
      item: this.item,
      itemName: this.item.name,
      itemId: this.item.id,
      itemDescription: this.item.system.description || '',
      
      // Configuration
      encrypted,
      encryptionDC,
      encryptionType,
      encryptionMode, // NEW
      failureMode,
      theme,
      isSingleMode: dataShardType === 'single',
      
      // Network (EXISTING)
      requiresNetwork,
      requiredNetwork,
      networkAvailable,
      signalStrength: 100, // TODO: Get real signal strength
      
      // Login (EXISTING)
      requiresLogin,
      isLoggedIn,
      
      // Status (UPDATED)
      isDecrypted: isShardDecrypted, // Renamed for clarity
      isShardDecrypted, // NEW: explicit shard decryption status
      isLockedOut,
      lockoutMinutes,
      canHack: canHackShard, // Renamed for clarity
      canHackShard, // NEW: explicit shard hack ability
      canAccessInbox, // UPDATED: renamed from canAccess
      showEncryptedOverlay: showShardEncryptedOverlay, // UPDATED: shard-level overlay
      showShardEncryptedOverlay, // NEW: explicit shard overlay
      attemptingHack: this.attemptingHack,
      
      // Messages (UPDATED with encryption info)
      messages,
      messageCount: messages.length,
      selectedMessage, // ENHANCED with per-message encryption
      hasMessages: messages.length > 0,
      
      // Hack data (EXISTING)
      previousAttempts,
      selectedActor,
      
      // Permissions (EXISTING)
      isOwner: this.item.isOwner,
      isGM: game.user.isGM,
      canAddMessage: this.item.isOwner || game.user.isGM,
      
      // NEW: Encryption mode info (for UI decisions)
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
    
    html.find('[data-action="gm-reset-encryption"]').click(this._onGMResetEncryption.bind(this));
    html.find('[data-action="gm-reset-attempts"]').click(this._onGMResetAttempts.bind(this));
    html.find('[data-action="gm-view-all"]').click(this._onGMViewAll.bind(this));
    html.find('[data-action="select-message"]').click(this._onMessageSelect.bind(this));
    html.find('[data-action="attempt-hack"]').click(this._onHackAttempt.bind(this));
    html.find('[data-action="add-message"]').click(this._onAddMessage.bind(this));
    html.find('[data-action="share-message"]').click(this._onShareMessage.bind(this));
    html.find('[data-action="delete-message"]').click(this._onDeleteMessage.bind(this));
    html.find('[data-action="configure"]').click(this._onConfigure.bind(this));
    html.find('[data-action="close"]').click(() => this.close());
    html.find('[data-action="gm-force-decrypt"]').click(this._onGMForceDecrypt.bind(this));
    html.find('[data-action="gm-bypass-login"]').click(this._onGMBypassLogin.bind(this));
    html.find('[data-action="gm-override-network"]').click(this._onGMOverrideNetwork.bind(this));
    html.find('[data-action="login"]').click(this._onLogin.bind(this));
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
      ui.notifications.error('You must have a character selected to hack');
      return;
    }

    // Check available skills
    const availableSkills = this.dataShardService.getAvailableSkills(this.item, actor);
      
    if (availableSkills.length === 0) {
      const allowedSkills = this.item.getFlag(MODULE_ID, 'allowedSkills') || ['Interface'];
      ui.notifications.warn(`${actor.name} doesn't have the required skills: ${allowedSkills.join(', ')}`);
      return;
    }
      
    // Log available skills for debugging
    console.log(`${MODULE_ID} | ${actor.name} can use:`, availableSkills.map(s => s.displayName).join(', '));
    
    // Confirm the attempt
    const confirmed = await Dialog.confirm({
      title: "Attempt Hack",
      content: `
        <p>Attempt to decrypt this data shard?</p>
        <p><strong>Encryption:</strong> ${this.item.getFlag(MODULE_ID, 'encryptionType') || 'ICE'}</p>
        <p><strong>Difficulty:</strong> DV ${this.item.getFlag(MODULE_ID, 'encryptionDC') || 15}</p>
        <p><strong>Failure Mode:</strong> ${this.item.getFlag(MODULE_ID, 'failureMode') || 'Lockout'}</p>
      `
    });
    
    if (!confirmed) return;
    
    // Set state
    this.attemptingHack = true;
    this.render(false);
    
    try {
      // Attempt the hack
      const result = await this.dataShardService.attemptHack(this.item, actor);
      
      if (result.success) {
        // Success! Reload messages
        await this._loadMessages();
        ui.notifications.info('Data shard decrypted successfully!');
        
        // Record successful attempt
        await this._recordHackAttempt(actor, true, result.total);
      } else {
        ui.notifications.error(`Hack failed: ${result.consequence || 'Access denied'}`);
        
        // Record failed attempt
        await this._recordHackAttempt(actor, false, result.total);
      }
      
    } catch (error) {
      console.error(`${MODULE_ID} | Hack attempt error:`, error);
      ui.notifications.error('Hack attempt failed');
    } finally {
      this.attemptingHack = false;
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
  
  /**
   * GM force decrypt (NEW)
   * @private
   */
  async _onGMForceDecrypt(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.error('Only GMs can force decrypt');
      return;
    }
    
    await this.item.setFlag(MODULE_ID, 'decrypted', true);
    await this._loadMessages();
    this.render(false);
    ui.notifications.info('GM Override: Data shard decrypted');
  }
  
  /**
   * GM bypass login (NEW)
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
  }
  
  /**
   * GM override network (NEW)
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
  }
  
  /**
   * Handle login (NEW)
   * @private
   */
  async _onLogin(event) {
    event.preventDefault();
    
    const html = $(event.currentTarget).closest('.ncm-item-inbox__login-form');
    const username = html.find('input[name="username"]').val();
    const password = html.find('input[name="password"]').val();
    
    const savedUsername = this.item.getFlag(MODULE_ID, 'loginUsername');
    const savedPassword = this.item.getFlag(MODULE_ID, 'loginPassword');
    
    if (username === savedUsername && password === savedPassword) {
      await this.item.setFlag(MODULE_ID, 'sessionLoggedIn', true);
      this.render(false);
      ui.notifications.info('Login successful!');
    } else {
      ui.notifications.error('Invalid credentials');
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
    
    const confirmed = await Dialog.confirm({
      title: "Reset Encryption",
      content: "<p>Re-lock this data shard? Players will need to hack it again.</p>"
    });
    
    if (!confirmed) return;
    
    try {
      await this.item.setFlag(MODULE_ID, 'decrypted', false);
      await this.item.setFlag(MODULE_ID, 'hackAttempts', 0);
      await this.item.setFlag(MODULE_ID, 'lockoutUntil', null);
      
      // Clear localStorage for all users
      const storageKey = `${MODULE_ID}-decrypted-${this.item.id}`;
      localStorage.removeItem(storageKey);
      
      ui.notifications.info('Data shard re-locked');
      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Error resetting encryption:`, error);
      ui.notifications.error('Failed to reset encryption');
    }
  }

  /**
   * GM: Reset hack attempts
   * @private
   */
  async _onGMResetAttempts(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.error('Only GMs can reset attempts');
      return;
    }
    
    try {
      await this.item.setFlag(MODULE_ID, 'hackAttempts', 0);
      await this.item.setFlag(MODULE_ID, 'lockoutUntil', null);
      
      ui.notifications.info('Hack attempts reset');
      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Error resetting attempts:`, error);
      ui.notifications.error('Failed to reset attempts');
    }
  }

  /**
   * GM: View all messages (ignore encryption)
   * @private
   */
  async _onGMViewAll(event) {
    event.preventDefault();
    
    if (!game.user.isGM) {
      ui.notifications.error('Only GMs can use this');
      return;
    }
    
    ui.notifications.info('GM Override: Viewing all messages');
    // The template already checks isGM for showing content
    this.render(false);
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