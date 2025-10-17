/**
 * Item Inbox Configuration Dialog
 * File: scripts/ui/components/ItemInbox/ItemInboxConfig.js
 * Module: cyberpunkred-messenger
 * Description: Configure an item as a data shard
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { DataShardService } from '../../../services/DataShardService.js';

export class ItemInboxConfig extends FormApplication {
  constructor(item, options = {}) {
    super(item, options);
    this.item = item;
    this.dataShardService = new DataShardService();
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
  
  getData(options = {}) {
    const data = super.getData(options);
    
    // Check if already configured
    const isDataShard = this.item.getFlag(MODULE_ID, 'isDataShard') || false;
    
    // Get current configuration
    const dataShardType = this.item.getFlag(MODULE_ID, 'dataShardType') || 'multi';
    const encrypted = this.item.getFlag(MODULE_ID, 'encrypted') || false;
    const encryptionDC = this.item.getFlag(MODULE_ID, 'encryptionDC') || 15;
    const encryptionType = this.item.getFlag(MODULE_ID, 'encryptionType') || 'ICE';
    const failureMode = this.item.getFlag(MODULE_ID, 'failureMode') || 'lockout';
    const theme = this.item.getFlag(MODULE_ID, 'theme') || 'default';
    
    return {
      ...data,
      item: this.item,
      isDataShard,
      
      // Configuration options
      dataShardType,
      encrypted,
      encryptionDC,
      encryptionType,
      failureMode,
      theme,
      
      // Options lists
      encryptionTypes: [
        { value: 'ICE', label: 'ICE (Standard)' },
        { value: 'BLACKICE', label: 'BLACK ICE (Lethal)' },
        { value: 'BASIC', label: 'Basic Encryption' },
        { value: 'QUANTUM', label: 'Quantum Encryption' }
      ],
      
      failureModes: [
        { value: 'lockout', label: 'Lockout (1 hour)' },
        { value: 'traceback', label: 'Traceback (Alert owner)' },
        { value: 'damage', label: 'EMP Damage (1d6)' },
        { value: 'corrupt', label: 'Data Corruption' }
      ],
      
      themes: [
        { value: 'default', label: 'Default' },
        { value: 'arasaka', label: 'Arasaka' },
        { value: 'militech', label: 'Militech' },
        { value: 'netwatch', label: 'NetWatch' },
        { value: 'trauma', label: 'Trauma Team' },
        { value: 'scav', label: 'Scavenger' }
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
  
  async _updateObject(event, formData) {
    console.log(`${MODULE_ID} | Configuring data shard:`, formData);
    
    try {
      // Check if enabling or disabling
      const enableDataShard = formData.enableDataShard;
      
      if (enableDataShard) {
        // Convert to data shard
        const config = {
          type: formData.dataShardType,
          encrypted: formData.encrypted,
          encryptionDC: parseInt(formData.encryptionDC),
          encryptionType: formData.encryptionType,
          failureMode: formData.failureMode,
          theme: formData.theme
        };
        
        await this.dataShardService.convertToDataShard(this.item, config);
        
        ui.notifications.info(`${this.item.name} configured as data shard!`);
        
        // Open the item inbox
        setTimeout(async () => {
          const { ItemInboxApp } = await import('./ItemInboxApp.js');
          new ItemInboxApp(this.item).render(true);
        }, 500);
        
      } else {
        // Disable data shard
        await this.item.unsetFlag(MODULE_ID, 'isDataShard');
        await this.item.unsetFlag(MODULE_ID, 'dataShardType');
        await this.item.unsetFlag(MODULE_ID, 'encrypted');
        await this.item.unsetFlag(MODULE_ID, 'encryptionDC');
        await this.item.unsetFlag(MODULE_ID, 'encryptionType');
        await this.item.unsetFlag(MODULE_ID, 'failureMode');
        await this.item.unsetFlag(MODULE_ID, 'theme');
        
        ui.notifications.info(`${this.item.name} is no longer a data shard`);
      }
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error configuring data shard:`, error);
      ui.notifications.error('Failed to configure data shard');
    }
  }
}