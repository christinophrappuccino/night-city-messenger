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
    this.gmViewAllMode = false;
    
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
   * Get data for template
   */
  async getData() {
    const data = await super.getData();
    
    // ========================================================================
    // Basic Item Data
    // ========================================================================
    const encrypted = this.item.getFlag(MODULE_ID, 'encrypted') || false;
    const encryptionDC = this.item.getFlag(MODULE_ID, 'encryptionDC') || 15;
    const encryptionType = this.item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
    const encryptionMode = this.item.getFlag(MODULE_ID, 'encryptionMode') || 'shard';
    const failureMode = this.item.getFlag(MODULE_ID, 'failureMode') || 'Lockout';
    const dataShardType = this.item.getFlag(MODULE_ID, 'dataShardType') || 'multi';
    const theme = this.item.getFlag(MODULE_ID, 'theme') || 'default';
    
    // Network requirements
    const requiresNetwork = this.item.getFlag(MODULE_ID, 'requiresNetwork') || false;
    const requiredNetwork = this.item.getFlag(MODULE_ID, 'requiredNetwork') || 'CITINET';
    const networkAvailable = true; // TODO: Check actual network
    
    // Login requirements
    const requiresLogin = this.item.getFlag(MODULE_ID, 'requiresLogin') || false;
    const isLoggedIn = this.item.getFlag(MODULE_ID, 'isLoggedIn') || false;
    
    // ========================================================================
    // CRITICAL: Encryption State
    // ========================================================================
    
    // The ACTUAL decryption state of the shard
    const isActuallyDecrypted = this.item.getFlag(MODULE_ID, 'decrypted') || false;
    
    // Whether shard-level encryption is active
    const shardEncryptionActive = encrypted && 
                                   (encryptionMode === 'shard' || encryptionMode === 'both');
    
    // ========================================================================
    // Lockout State
    // ========================================================================
    const lockoutUntil = this.item.getFlag(MODULE_ID, 'lockoutUntil');
    const isLockedOut = lockoutUntil && Date.now() < new Date(lockoutUntil).getTime();
    const lockoutMinutes = isLockedOut 
      ? Math.ceil((new Date(lockoutUntil).getTime() - Date.now()) / 60000)
      : 0;
    
    // ========================================================================
    // CRITICAL: Access Control Logic
    // ========================================================================
    
    // Can the user access the inbox?
    const canAccessInbox = !shardEncryptionActive ||  // No shard encryption
                           isActuallyDecrypted ||      // Already decrypted
                           this.gmViewAllMode ||       // GM viewing all
                           game.user.isGM;             // GMs can always access
    
    // Should we show the shard-level encrypted overlay?
    const showShardEncryptedOverlay = shardEncryptionActive &&    // Shard encryption is on
                                       !isActuallyDecrypted &&    // Not decrypted yet
                                       !this.gmViewAllMode;        // Not GM view mode
    
    // ========================================================================
    // CRITICAL FIX: Can user attempt to hack the shard?
    // ========================================================================
    const hasCharacter = !!game.user.character;
    
    const canHackShard = hasCharacter &&              // Must have a character
                         shardEncryptionActive &&     // Shard must be encrypted
                         !isActuallyDecrypted &&      // Not already decrypted
                         !isLockedOut &&              // Not locked out
                         !game.user.isGM &&           // Players only (GMs can force)
                         !this.gmViewAllMode;         // Not in GM view mode
    
    // Debug output
    console.log(`${MODULE_ID} | getData() canHackShard calculation:`, {
      hasCharacter,
      shardEncryptionActive,
      isActuallyDecrypted,
      isLockedOut,
      isGM: game.user.isGM,
      gmViewAllMode: this.gmViewAllMode,
      RESULT: canHackShard
    });
    
    // ========================================================================
    // Load Messages
    // ========================================================================
    if (!this.messages || this.messages.length === 0) {
      await this._loadMessages();
    }
    
    const messages = this.messages || [];
    
    // ========================================================================
    // Selected Message
    // ========================================================================
    let selectedMessage = null;
    
    if (this.selectedMessageId) {
      const msg = messages.find(m => m.id === this.selectedMessageId);
      
      if (msg) {
        // Message-level encryption state
        const messageEncrypted = msg.messageData?.encrypted || false;
        const messageDecrypted = msg.messageData?.decrypted || false;
        
        // Can we show the content?
        const showContent = !messageEncrypted ||     // Not encrypted
                           messageDecrypted ||       // Decrypted
                           this.gmViewAllMode;       // GM viewing
        
        // Should we show per-message overlay?
        const showEncryptedOverlay = messageEncrypted && 
                                    !messageDecrypted && 
                                    !this.gmViewAllMode;
        
        // Can user decrypt this message?
        const canDecryptMessage = messageEncrypted && 
                                 !messageDecrypted && 
                                 hasCharacter &&
                                 !game.user.isGM;
        
        selectedMessage = {
          ...msg,
          messageData: msg.messageData || {},
          content: msg.content || '',
          canView: canAccessInbox,
          attachments: msg.attachments || [],
          infected: msg.messageData?.infected || false,
          malwareType: msg.messageData?.malwareType || null,
          threatLevel: msg.messageData?.threatLevel || 'unknown',
          
          // Per-message encryption status
          showContent,
          showEncryptedOverlay,
          canDecrypt: canDecryptMessage,
          encryption: msg.encryption || null
        };
      }
    }
    
    // ========================================================================
    // Hack History
    // ========================================================================
    const previousAttempts = this.item.getFlag(MODULE_ID, 'hackAttempts') || [];
    const selectedActor = game.user.character;
    
    // ========================================================================
    // Return Complete Data Object
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
      encryptionMode,
      failureMode,
      theme,
      isSingleMode: dataShardType === 'single',
      
      // Network
      requiresNetwork,
      requiredNetwork,
      networkAvailable,
      signalStrength: 100,
      
      // Login
      requiresLogin,
      isLoggedIn,
      
      // Encryption state
      isActuallyDecrypted,
      isShardDecrypted: isActuallyDecrypted, // Alias
      
      // Lockout
      isLockedOut,
      lockoutMinutes,
      
      // Access control
      canHackShard,     
      canAccessInbox,
      showShardEncryptedOverlay,
      attemptingHack: this.attemptingHack,
      
      // Messages
      messages,
      messageCount: messages.length,
      selectedMessage,
      hasMessages: messages.length > 0,
      
      // Hack data
      previousAttempts,
      selectedActor,
      
      // Permissions
      isOwner: this.item.isOwner,
      isGM: game.user.isGM,
      canAddMessage: this.item.isOwner || game.user.isGM,
      
      // GM controls
      gmViewMode: this.gmViewAllMode || false,
      
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
    
    // GM Controls
    html.find('[data-action="gm-force-decrypt"]').click(this._onGMForceDecrypt.bind(this));
    html.find('[data-action="gm-reset-encryption"]').click(this._onGMResetEncryption.bind(this));
    html.find('[data-action="gm-reset-attempts"]').click(this._onGMResetAttempts.bind(this));
    html.find('[data-action="gm-view-all"]').click(this._onGMViewAll.bind(this));
    
    // Other existing actions
    html.find('[data-action="gm-bypass-login"]').click(this._onGMBypassLogin.bind(this));
    html.find('[data-action="gm-override-network"]').click(this._onGMOverrideNetwork.bind(this));
    html.find('[data-action="login"]').click(this._onLogin.bind(this));
    html.find('[data-action="quarantine-message"]').click(this._onQuarantineMessage.bind(this));
    html.find('[data-action="decrypt-message"]').click(this._onDecryptMessage.bind(this));
    
    // CRITICAL FIX: Debug and rebind the attempt-hack button  
    console.log(`${MODULE_ID} | Setting up attempt-hack button`);
    
    const hackButton = html.find('[data-action="attempt-hack"]');
    console.log(`${MODULE_ID} | Found ${hackButton.length} hack buttons`);
    
    if (hackButton.length > 0) {
      // Remove any existing handlers and add new one
      hackButton.off('click').on('click', (event) => {
        console.log(`${MODULE_ID} | Hack button clicked!`);
        this._onHackAttempt(event);
      });
      console.log(`${MODULE_ID} | ✓ Hack button handler attached`);
    } else {
      console.warn(`${MODULE_ID} | ⚠ No hack button found in DOM`);
    }
    
    // Apply layout mode
    this._applyLayoutMode(html);
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
    
    console.log(`${MODULE_ID} | Hack attempt initiated`);
    
    // Check for character
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
    
    console.log(`${MODULE_ID} | ${actor.name} can use:`, availableSkills.map(s => s.displayName).join(', '));
    
    // Get encryption info
    const encryptionType = this.item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
    const encryptionDC = this.item.getFlag(MODULE_ID, 'encryptionDC') || 15;
    const failureMode = this.item.getFlag(MODULE_ID, 'failureMode') || 'Lockout';
    
    // Show confirmation dialog
    const confirmed = await new Promise(resolve => {
      const dialog = new Dialog({
        title: "Attempt Data Shard Hack",
        content: `
          <div style="padding: 15px;">
            <p style="font-size: 1.1em; margin-bottom: 15px;">
              <strong>Attempt to decrypt this data shard?</strong>
            </p>
            <hr style="margin: 15px 0; border-color: rgba(246, 82, 97, 0.3);">
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 15px 0;">
              <div>
                <strong style="color: var(--ncm-text-dim);">Encryption Type:</strong>
                <div style="color: var(--ncm-primary); font-weight: bold;">${encryptionType}</div>
              </div>
              <div>
                <strong style="color: var(--ncm-text-dim);">Difficulty:</strong>
                <div style="color: var(--ncm-primary); font-weight: bold;">DV ${encryptionDC}</div>
              </div>
              <div>
                <strong style="color: var(--ncm-text-dim);">Failure Mode:</strong>
                <div style="color: var(--ncm-warning);">${failureMode}</div>
              </div>
              <div>
                <strong style="color: var(--ncm-text-dim);">Available Skills:</strong>
                <div style="color: var(--ncm-secondary);">${availableSkills.map(s => s.displayName).join(', ')}</div>
              </div>
            </div>
            
            <hr style="margin: 15px 0; border-color: rgba(246, 82, 97, 0.3);">
            
            ${encryptionType.includes('BLACK_ICE') || encryptionType.includes('RED_ICE') ? `
              <div style="background: rgba(255, 0, 0, 0.15); border: 2px solid var(--ncm-error); padding: 12px; border-radius: 4px; margin: 10px 0;">
                <p style="color: var(--ncm-error); font-weight: bold; margin: 0;">
                  <i class="fas fa-skull-crossbones"></i> WARNING: LETHAL COUNTERMEASURES ACTIVE
                </p>
                <p style="color: var(--ncm-text); margin: 5px 0 0 0; font-size: 0.9em;">
                  Failure may result in BLACK ICE deployment and serious injury!
                </p>
              </div>
            ` : `
              <p style="color: #F65261; margin: 10px 0;">
                <strong>⚠ Warning:</strong> Failure may trigger security countermeasures!
              </p>
            `}
          </div>
        `,
        buttons: {
          hack: {
            icon: '<i class="fas fa-terminal"></i>',
            label: "Attempt Hack",
            callback: () => resolve(true)
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancel",
            callback: () => resolve(false)
          }
        },
        default: "hack",
        close: () => resolve(false)
      });
      
      // CRITICAL FIX: Position dialog after render
      dialog.render(true, {
        width: 520,
        height: "auto"
      });
      
      // Wait for dialog to be in DOM, then center it
      Hooks.once('renderDialog', (app, html, data) => {
        if (app === dialog) {
          // Center the dialog
          const dialogEl = html.closest('.app');
          if (dialogEl.length) {
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            const dialogWidth = dialogEl.outerWidth();
            const dialogHeight = dialogEl.outerHeight();
            
            const left = Math.max(100, (windowWidth - dialogWidth) / 2);
            const top = Math.max(100, (windowHeight - dialogHeight) / 2);
            
            dialogEl.css({
              left: `${left}px`,
              top: `${top}px`
            });
            
            console.log(`${MODULE_ID} | Dialog positioned at (${left}, ${top})`);
          }
        }
      });
    });
    
    if (!confirmed) {
      console.log(`${MODULE_ID} | Hack attempt cancelled by user`);
      return;
    }
    
    // Set hacking state
    this.attemptingHack = true;
    this.render(false);
    
    try {
      console.log(`${MODULE_ID} | Starting hack attempt with SkillService`);
      
      // Attempt the hack (this will trigger Cyberpunk RED skill roll + Luck)
      const result = await this.dataShardService.attemptHack(this.item, actor);
      
      if (result.success) {
        // Success!
        ui.notifications.info('Data shard decrypted successfully!');
        await this._loadMessages();
        await this._recordHackAttempt(actor, true, result.total);
        
        // Create success chat message
        await ChatMessage.create({
          content: `
            <div style="background: rgba(25, 243, 247, 0.1); border: 2px solid var(--ncm-secondary); padding: 15px; border-radius: 4px;">
              <p style="font-weight: bold; color: var(--ncm-secondary); margin-bottom: 8px;">
                <i class="fas fa-check-circle"></i> HACK SUCCESSFUL
              </p>
              <p style="margin: 0;">
                <strong>${actor.name}</strong> successfully decrypted 
                <strong>${this.item.name}</strong> (DV ${encryptionDC})
              </p>
              <p style="margin: 5px 0 0 0; color: var(--ncm-text-dim); font-size: 0.9em;">
                Roll: ${result.total} vs DV ${encryptionDC}
              </p>
            </div>
          `,
          speaker: ChatMessage.getSpeaker({ actor }),
          type: CONST.CHAT_MESSAGE_TYPES.OTHER
        });
        
      } else {
        // Failure
        ui.notifications.error(`Hack failed: ${result.consequence || 'Access denied'}`);
        await this._recordHackAttempt(actor, false, result.total);
        
        // Create failure chat message
        await ChatMessage.create({
          content: `
            <div style="background: rgba(246, 82, 97, 0.1); border: 2px solid var(--ncm-primary); padding: 15px; border-radius: 4px;">
              <p style="font-weight: bold; color: var(--ncm-primary); margin-bottom: 8px;">
                <i class="fas fa-times-circle"></i> HACK FAILED
              </p>
              <p style="margin: 0;">
                <strong>${actor.name}</strong> failed to decrypt 
                <strong>${this.item.name}</strong>
              </p>
              <p style="margin: 5px 0 0 0; color: var(--ncm-text-dim); font-size: 0.9em;">
                Roll: ${result.total} vs DV ${encryptionDC}
              </p>
              ${result.consequence ? `
                <p style="margin: 8px 0 0 0; color: var(--ncm-error); font-weight: bold;">
                  <i class="fas fa-exclamation-triangle"></i> ${result.consequence}
                </p>
              ` : ''}
            </div>
          `,
          speaker: ChatMessage.getSpeaker({ actor }),
          type: CONST.CHAT_MESSAGE_TYPES.OTHER
        });
      }
      
    } catch (error) {
      console.error(`${MODULE_ID} | Hack attempt error:`, error);
      ui.notifications.error('Hack attempt failed due to an error');
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
      content: `
        <p>Re-lock this data shard?</p>
        <p><strong>This will:</strong></p>
        <ul>
          <li>Lock the data shard</li>
          <li>Reset all hack attempts</li>
          <li>Clear the lockout timer</li>
          <li>Players will need to hack it again</li>
        </ul>
        <p><em>Useful for testing encryption mechanics.</em></p>
      `
    });
    
    if (!confirmed) return;
    
    try {
      // Lock the shard
      await this.item.setFlag(MODULE_ID, 'decrypted', false);
      
      // Clear lockout
      await this.item.unsetFlag(MODULE_ID, 'lockoutUntil');
      
      // Reset hack attempts
      await this.item.setFlag(MODULE_ID, 'hackAttempts', 0);
      
      // Clear any localStorage decryption keys for all users
      const storageKey = `${MODULE_ID}-decrypted-${this.item.id}`;
      localStorage.removeItem(storageKey);
      
      // Re-render
      this.render(false);
      
      // Notification
      ui.notifications.info('GM Override: Data shard re-locked');
      
      // Create chat message
      await ChatMessage.create({
        content: `
          <div style="background: rgba(255, 215, 0, 0.1); border: 1px solid #FFD700; padding: 10px; border-radius: 4px;">
            <p><strong style="color: #FFD700;"><i class="fas fa-crown"></i> GM OVERRIDE</strong></p>
            <p>Data shard <strong>${this.item.name}</strong> was re-locked.</p>
            <p><em>Encryption reset for testing.</em></p>
          </div>
        `,
        whisper: [game.user.id]
      });
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error resetting encryption:`, error);
      ui.notifications.error('Failed to reset encryption');
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
   * GM: Toggle "view all" mode (ignore encryption for GM)
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