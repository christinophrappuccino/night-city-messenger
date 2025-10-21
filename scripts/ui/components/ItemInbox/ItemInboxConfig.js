/**
 * Item Inbox Configuration Dialog
 * File: scripts/ui/components/ItemInbox/ItemInboxConfig.js
 * Module: cyberpunkred-messenger
 * Description: Configure an item as a data shard
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { BaseApplication } from '../BaseApplication.js';
import { EventBus } from '../../../core/EventBus.js';
import { DataShardService } from '../../../services/DataShardService.js';

export class ItemInboxConfig extends FormApplication {
  constructor(item, options = {}) {
    super(item, options);
    this.item = item;
    const eventBus = EventBus.getInstance();
    this.dataShardService = new DataShardService(eventBus);
  }
  
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ncm-app", "ncm-item-inbox-config"],
      template: `modules/${MODULE_ID}/templates/item-inbox/item-inbox-config.hbs`,
      width: 500,
      height: "auto",
      title: "Configure Data Shard",
      closeOnSubmit: true,
      submitOnChange: false
    });
  }
  
  async getData(options = {}) {
    const data = await super.getData(options);
    
    // Get current configuration
    const isDataShard = this.item.getFlag(MODULE_ID, 'isDataShard') || false;
    const encrypted = this.item.getFlag(MODULE_ID, 'encrypted') || false;
    const encryptionType = this.item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
    const encryptionDC = this.item.getFlag(MODULE_ID, 'encryptionDC') || 15;
    const encryptionMode = this.item.getFlag(MODULE_ID, 'encryptionMode') || 'shard'; // NEW
    const allowedSkills = this.item.getFlag(MODULE_ID, 'allowedSkills') || ['Interface', 'Electronics/Security Tech'];
    const failureMode = this.item.getFlag(MODULE_ID, 'failureMode') || 'lockout';
    const singleMessage = this.item.getFlag(MODULE_ID, 'singleMessage') || false;
    const theme = this.item.getFlag(MODULE_ID, 'theme') || 'classic';
    
    // Import constants for skill options
    const { SKILL_PRESETS, CYBERPUNK_SKILLS } = await import('../../../utils/constants.js');
    
    return {
      ...data,
      item: this.item,
      isDataShard,
      encrypted,
      encryptionType,
      encryptionDC,
      encryptionMode, // NEW
      allowedSkills,
      failureMode,
      singleMessage,
      theme,
      
      // Encryption mode options (NEW)
      encryptionModes: {
        shard: {
          value: 'shard',
          label: 'Data Shard Level',
          description: 'Entire inbox is encrypted - hack once to see all messages'
        },
        message: {
          value: 'message',
          label: 'Per Message',
          description: 'Each message can be individually encrypted - hack each separately'
        },
        both: {
          value: 'both',
          label: 'Both Layers',
          description: 'Shard is encrypted AND individual messages can be encrypted too'
        }
      },
      
      // Skill options
      skillPresets: SKILL_PRESETS,
      techSkills: Object.values(CYBERPUNK_SKILLS.TECH),
      intSkills: Object.values(CYBERPUNK_SKILLS.INTELLIGENCE),
      
      // Encryption types
      encryptionTypes: [
        { value: 'ICE', label: 'Standard ICE', damage: 'None' },
        { value: 'BLACK_ICE', label: 'BLACK ICE (Lethal)', damage: '3d6' },
        { value: 'RED_ICE', label: 'RED ICE (Extreme)', damage: '5d6' }
      ],
      
      // Failure modes
      failureModes: [
        { value: 'nothing', label: 'Nothing (Can Retry)' },
        { value: 'lockout', label: 'Temporary Lockout (1 hour)' },
        { value: 'permanent', label: 'Permanent Lock' },
        { value: 'destroy', label: 'Destroy Data' }
      ],
      
      // Themes
      themes: [
        { value: 'classic', label: 'Classic Red' },
        { value: 'arasaka', label: 'Arasaka Corporate' },
        { value: 'militech', label: 'Militech Military' },
        { value: 'netwatch', label: 'NetWatch Official' },
        { value: 'neon', label: 'Neon City' }
      ]
    };
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
    // Toggle encryption options
    html.find('[name="encrypted"]').change((event) => {
      const encrypted = event.target.checked;
      html.find('.ncm-encryption-options').toggle(encrypted);
    });
    
    // Trigger initial state
    html.find('[name="encrypted"]').trigger('change');
  }
  
  /**
   * Handle form submission
   */
  async _updateObject(event, formData) {
    console.log(`${MODULE_ID} | Configuring data shard with form data:`, formData);
    
    try {
      const eventBus = EventBus.getInstance();
      const dataShardService = new DataShardService(eventBus);
      
      // CRITICAL FIX: Process form data to prevent duplicates
      // FoundryVTT's FormDataExtended can create arrays for single values
      // We need to ensure single-value fields remain single values
      
      // Clean up single-value fields (take first value if array)
      const encryptionType = Array.isArray(formData.encryptionType) 
        ? formData.encryptionType[0] 
        : (formData.encryptionType || 'ICE');
        
      const failureMode = Array.isArray(formData.failureMode)
        ? formData.failureMode[0]
        : (formData.failureMode || 'lockout');
        
      const encryptionMode = Array.isArray(formData.encryptionMode)
        ? formData.encryptionMode[0]
        : (formData.encryptionMode || 'shard');
        
      const theme = Array.isArray(formData.theme)
        ? formData.theme[0]
        : (formData.theme || 'classic');
      
      // Clean up numeric fields
      const encryptionDC = parseInt(
        Array.isArray(formData.encryptionDC) 
          ? formData.encryptionDC[0] 
          : formData.encryptionDC
      ) || 15;
      
      // Clean up boolean fields
      const encrypted = Array.isArray(formData.encrypted)
        ? formData.encrypted[0]
        : formData.encrypted;
        
      const singleMessage = Array.isArray(formData.singleMessage)
        ? formData.singleMessage[0]
        : formData.singleMessage;
      
      // Collect allowed skills (this SHOULD be an array)
      const allowedSkills = [];
      if (formData.allowedSkills) {
        if (Array.isArray(formData.allowedSkills)) {
          allowedSkills.push(...formData.allowedSkills.filter(s => s && s !== ''));
        } else if (formData.allowedSkills && formData.allowedSkills !== '') {
          allowedSkills.push(formData.allowedSkills);
        }
      }
      
      // If no skills selected, use defaults
      if (allowedSkills.length === 0) {
        allowedSkills.push('Interface', 'Electronics/Security Tech');
      }
      
      console.log(`${MODULE_ID} | Cleaned form data:`, {
        encrypted,
        encryptionType,
        encryptionDC,
        encryptionMode,
        failureMode,
        allowedSkills,
        singleMessage,
        theme
      });
      
      // If not a data shard yet, convert it
      if (!this.item.getFlag(MODULE_ID, 'isDataShard')) {
        await dataShardService.convertToDataShard(this.item, {
          encrypted: !!encrypted,
          encryptionType,
          encryptionDC,
          encryptionMode,
          allowedSkills,
          failureMode,
          singleMessage: !!singleMessage,
          theme
        });
      } else {
        // Update existing data shard flags one by one
        await this.item.setFlag(MODULE_ID, 'encrypted', !!encrypted);
        await this.item.setFlag(MODULE_ID, 'encryptionType', encryptionType);
        await this.item.setFlag(MODULE_ID, 'encryptionDC', encryptionDC);
        await this.item.setFlag(MODULE_ID, 'encryptionMode', encryptionMode);
        await this.item.setFlag(MODULE_ID, 'allowedSkills', allowedSkills);
        await this.item.setFlag(MODULE_ID, 'failureMode', failureMode);
        await this.item.setFlag(MODULE_ID, 'singleMessage', !!singleMessage);
        await this.item.setFlag(MODULE_ID, 'theme', theme);
      }
      
      ui.notifications.info('Data shard configuration updated!');
      
      // Refresh any open ItemInboxApp for this item
      for (const app of Object.values(ui.windows)) {
        if (app.item?.id === this.item.id) {
          app.render(false);
        }
      }
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error configuring data shard:`, error);
      ui.notifications.error('Failed to configure data shard');
      throw error;
    }
  }
}