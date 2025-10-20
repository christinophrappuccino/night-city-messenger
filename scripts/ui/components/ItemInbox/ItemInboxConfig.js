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
    console.log(`${MODULE_ID} | Configuring data shard:`, formData);
    
    try {
      const eventBus = EventBus.getInstance();
      const dataShardService = new DataShardService(eventBus);
      
      // Collect allowed skills (multiple checkboxes)
      const allowedSkills = [];
      if (formData.allowedSkills) {
        if (Array.isArray(formData.allowedSkills)) {
          allowedSkills.push(...formData.allowedSkills);
        } else {
          allowedSkills.push(formData.allowedSkills);
        }
      }
      
      // If not a data shard yet, convert it
      if (!this.item.getFlag(MODULE_ID, 'isDataShard')) {
        await dataShardService.convertToDataShard(this.item, {
          encrypted: formData.encrypted || false,
          encryptionType: formData.encryptionType || 'ICE',
          encryptionDC: parseInt(formData.encryptionDC) || 15,
          encryptionMode: formData.encryptionMode || 'shard', // NEW
          allowedSkills: allowedSkills.length > 0 ? allowedSkills : ['Interface', 'Electronics/Security Tech'],
          failureMode: formData.failureMode || 'lockout',
          singleMessage: formData.singleMessage || false,
          theme: formData.theme || 'classic'
        });
      } else {
        // Update existing data shard
        await this.item.setFlag(MODULE_ID, 'encrypted', formData.encrypted || false);
        await this.item.setFlag(MODULE_ID, 'encryptionType', formData.encryptionType || 'ICE');
        await this.item.setFlag(MODULE_ID, 'encryptionDC', parseInt(formData.encryptionDC) || 15);
        await this.item.setFlag(MODULE_ID, 'encryptionMode', formData.encryptionMode || 'shard'); // NEW
        await this.item.setFlag(MODULE_ID, 'allowedSkills', allowedSkills.length > 0 ? allowedSkills : ['Interface', 'Electronics/Security Tech']);
        await this.item.setFlag(MODULE_ID, 'failureMode', formData.failureMode || 'lockout');
        await this.item.setFlag(MODULE_ID, 'singleMessage', formData.singleMessage || false);
        await this.item.setFlag(MODULE_ID, 'theme', formData.theme || 'classic');
      }
      
      ui.notifications.info('Data shard configuration updated');
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error configuring data shard:`, error);
      ui.notifications.error('Failed to configure data shard');
    }
  }
}