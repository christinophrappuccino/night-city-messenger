/**
 * Item Inbox Configuration Dialog
 * File: scripts/ui/components/ItemInbox/ItemInboxConfig.js
 * Module: cyberpunkred-messenger
 * Description: Configure an item as a data shard with multi-skill support
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
      width: 600,
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
    const encryptionMode = this.item.getFlag(MODULE_ID, 'encryptionMode') || 'shard';
    const allowedSkills = this.item.getFlag(MODULE_ID, 'allowedSkills') || ['Interface', 'Electronics/Security Tech'];
    const failureMode = this.item.getFlag(MODULE_ID, 'failureMode') || 'lockout';
    const singleMessage = this.item.getFlag(MODULE_ID, 'singleMessage') || false;
    const theme = this.item.getFlag(MODULE_ID, 'theme') || 'classic';
    
    // ========================================================================
    // MULTI-SKILL CONFIGURATION - Get individual DVs for each skill
    // ========================================================================
    const skillDCs = this.item.getFlag(MODULE_ID, 'skillDCs') || {
      'Interface': 15,
      'Electronics/Security Tech': 15,
      'Basic Tech': 17,
      'Cryptography': 18,
      'Education': 20,
      'Library Search': 20
    };
    
    // ========================================================================
    // NETWORK AND LOGIN SECURITY SETTINGS
    // ========================================================================
    const requiresNetwork = this.item.getFlag(MODULE_ID, 'requiresNetwork') || false;
    const requiredNetwork = this.item.getFlag(MODULE_ID, 'requiredNetwork') || 'CITINET';
    const requiresLogin = this.item.getFlag(MODULE_ID, 'requiresLogin') || false;
    const loginUsername = this.item.getFlag(MODULE_ID, 'loginUsername') || 'admin';
    const loginPassword = this.item.getFlag(MODULE_ID, 'loginPassword') || 'password';
    const maxLoginAttempts = this.item.getFlag(MODULE_ID, 'maxLoginAttempts') || 5;
    
    // Import constants for skill options
    const { SKILL_PRESETS, CYBERPUNK_SKILLS } = await import('../../../utils/constants.js');
    
    // ========================================================================
    // DYNAMIC SKILL LOADING - Get ALL skills from Cyberpunk RED system
    // ========================================================================
    const availableSkills = [];

    // Get all actors in the game
    const allActors = game.actors.filter(a => a.type === 'character');

    if (allActors.length > 0 && game.system.id === 'cyberpunk-red-core') {
      // Collect unique skills across all actors
      const uniqueSkills = new Map(); // Use Map to prevent duplicates
      
      for (const actor of allActors) {
        const actorSkills = actor.items.filter(i => i.type === 'skill');
        
        for (const skill of actorSkills) {
          const skillName = skill.name;
          
          // Only add if we haven't seen this skill before
          if (!uniqueSkills.has(skillName)) {
            const skillStat = skill.system?.stat?.toUpperCase() || 'OTHER';
            
            uniqueSkills.set(skillName, {
              id: skillName,
              name: skillName,
              stat: skillStat,
              description: `${skillStat} skill`
            });
          }
        }
      }
      
      // Group skills by stat
      const skillsBystat = {
        'INT': [],
        'REF': [],
        'TECH': [],
        'COOL': [],
        'WILL': [],
        'EMP': [],
        'BODY': [],
        'LUCK': [],
        'MOVE': [],
        'OTHER': []
      };
      
      // Add unique skills to stat groups
      for (const skill of uniqueSkills.values()) {
        const stat = skill.stat || 'OTHER';
        if (skillsBystat[stat]) {
          skillsBystat[stat].push(skill);
        } else {
          skillsBystat['OTHER'].push(skill);
        }
      }
      
      // Sort and add to availableSkills
      const statOrder = ['INT', 'TECH', 'COOL', 'REF', 'WILL', 'EMP', 'BODY', 'LUCK', 'MOVE', 'OTHER'];
      
      for (const stat of statOrder) {
        if (skillsBystat[stat].length > 0) {
          skillsBystat[stat].sort((a, b) => a.name.localeCompare(b.name));
          availableSkills.push(...skillsBystat[stat]);
        }
      }
      
      console.log(`${MODULE_ID} | Loaded ${availableSkills.length} unique skills from ${allActors.length} actors`);
      
    } else {
      // FALLBACK: If no actors or not Cyberpunk RED, use defaults
      console.warn(`${MODULE_ID} | No actors found or not Cyberpunk RED system, using default skills`);
      
      availableSkills.push(
        { id: 'Interface', name: 'Interface', stat: 'INT', description: 'Netrunning and network infiltration' },
        { id: 'Electronics/Security Tech', name: 'Electronics/Security Tech', stat: 'TECH', description: 'Technical hardware and security systems' },
        { id: 'Basic Tech', name: 'Basic Tech', stat: 'TECH', description: 'General technical knowledge' },
        { id: 'Cryptography', name: 'Cryptography', stat: 'INT', description: 'Code breaking and encryption' },
        { id: 'Education', name: 'Education', stat: 'INT', description: 'General knowledge and research' },
        { id: 'Library Search', name: 'Library Search', stat: 'INT', description: 'Information retrieval' }
      );
    }
    
    return {
      ...data,
      item: this.item,
      isDataShard,
      encrypted,
      encryptionType,
      encryptionDC,
      encryptionMode,
      allowedSkills,
      skillDCs,
      failureMode,
      singleMessage,
      theme,
      
      // Network and login settings
      requiresNetwork,
      requiredNetwork,
      requiresLogin,
      loginUsername,
      loginPassword,
      maxLoginAttempts,
      
      // Available skills with metadata
      availableSkills,
      
      // Encryption mode options
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
        { value: 'damage', label: 'BLACK ICE Damage' },
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
    
    // Toggle network options
    html.find('[name="requiresNetwork"]').change((event) => {
      const requiresNetwork = event.target.checked;
      html.find('.ncm-network-options').toggle(requiresNetwork);
    });
    
    // Toggle login options
    html.find('[name="requiresLogin"]').change((event) => {
      const requiresLogin = event.target.checked;
      html.find('.ncm-login-options').toggle(requiresLogin);
    });
    
    // ========================================================================
    // NEW: Toggle individual skill DC inputs
    // ========================================================================
    html.find('[name^="skillEnabled_"]').change((event) => {
      const skillId = event.target.value;
      const isEnabled = event.target.checked;
      const dcContainer = html.find(`[data-skill="${skillId}"]`);
      
      if (dcContainer.length) {
        dcContainer.toggle(isEnabled);
      }
    });
    
    // Trigger initial state for all toggles
    html.find('[name="encrypted"]').trigger('change');
    html.find('[name="requiresNetwork"]').trigger('change');
    html.find('[name="requiresLogin"]').trigger('change');
    
    // Trigger initial state for skill DC inputs
    html.find('[name^="skillEnabled_"]').each((index, element) => {
      $(element).trigger('change');
    });
  }
  
  /**
   * Handle form submission
   */
  async _updateObject(event, formData) {
    console.log(`${MODULE_ID} | Configuring data shard with form data:`, formData);
    
    try {
      const eventBus = EventBus.getInstance();
      const dataShardService = new DataShardService(eventBus);
      
      // ========================================================================
      // PROCESS FORM DATA - Clean up arrays
      // ========================================================================
      
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
      
      const encryptionDC = parseInt(
        Array.isArray(formData.encryptionDC) 
          ? formData.encryptionDC[0] 
          : formData.encryptionDC
      ) || 15;
      
      const maxLoginAttempts = parseInt(
        Array.isArray(formData.maxLoginAttempts)
          ? formData.maxLoginAttempts[0]
          : formData.maxLoginAttempts
      ) || 5;
      
      const encrypted = !!formData.encrypted;
      const singleMessage = !!formData.singleMessage;
      
      // ========================================================================
      // NETWORK AND LOGIN SECURITY FIELDS
      // ========================================================================
      const requiresNetwork = !!formData.requiresNetwork;
      const requiredNetwork = Array.isArray(formData.requiredNetwork)
        ? formData.requiredNetwork[0]
        : (formData.requiredNetwork || 'CITINET');
      
      const requiresLogin = !!formData.requiresLogin;
      const loginUsername = Array.isArray(formData.loginUsername)
        ? formData.loginUsername[0]
        : (formData.loginUsername || 'admin');
      const loginPassword = Array.isArray(formData.loginPassword)
        ? formData.loginPassword[0]
        : (formData.loginPassword || 'password');
      
      // ========================================================================
      // NEW: MULTI-SKILL CONFIGURATION WITH INDIVIDUAL DVs
      // ========================================================================
      const skillDCs = {};
      const allowedSkills = [];
      
      // ========================================================================
      // DYNAMIC SKILL PROCESSING - Process all skillEnabled_* checkboxes
      // ========================================================================

      // Get all field names that start with "skillEnabled_"
      const allFormFields = Object.keys(formData);
      const skillEnabledFields = allFormFields.filter(field => field.startsWith('skillEnabled_'));

      console.log(`${MODULE_ID} | Found ${skillEnabledFields.length} skill checkboxes in form`);

      // Process each skill checkbox and its associated DC
      for (const fieldName of skillEnabledFields) {
        const enabled = formData[fieldName];
        
        if (enabled) {
          // Extract skill ID from field name (e.g., "skillEnabled_Interface" → "Interface")
          const skillId = fieldName.replace('skillEnabled_', '');
          
          // Only add if it's a valid string (not empty)
          if (skillId && skillId.length > 0) {
            allowedSkills.push(skillId);
            
            // Get the DC for this skill (default to 15)
            const dcValue = formData[`skillDC_${skillId}`];
            const dc = parseInt(Array.isArray(dcValue) ? dcValue[0] : dcValue) || 15;
            skillDCs[skillId] = dc;
            
            console.log(`${MODULE_ID} | Added skill: ${skillId} with DV ${dc}`);
          }
        }
      }
      
      // If no skills selected, use defaults
      if (allowedSkills.length === 0) {
        allowedSkills.push('Interface', 'Electronics/Security Tech');
        skillDCs['Interface'] = 15;
        skillDCs['Electronics/Security Tech'] = 15;
      }
      
      console.log(`${MODULE_ID} | Cleaned form data:`, {
        encrypted,
        encryptionType,
        encryptionDC,
        encryptionMode,
        failureMode,
        allowedSkills,
        skillDCs,
        singleMessage,
        theme,
        requiresNetwork,
        requiredNetwork,
        requiresLogin,
        loginUsername,
        maxLoginAttempts
      });
      
      // ========================================================================
      // SAVE CONFIGURATION
      // ========================================================================
      
      if (!this.item.getFlag(MODULE_ID, 'isDataShard')) {
        // Convert to data shard
        await dataShardService.convertToDataShard(this.item, {
          encrypted,
          encryptionType,
          encryptionDC,
          encryptionMode,
          allowedSkills,
          skillDCs,
          failureMode,
          singleMessage,
          theme,
          requiresNetwork,
          requiredNetwork,
          requiresLogin,
          loginUsername,
          loginPassword,
          maxLoginAttempts
        });
      } else {
        // Update existing data shard
        await this.item.setFlag(MODULE_ID, 'encrypted', encrypted);
        await this.item.setFlag(MODULE_ID, 'encryptionType', encryptionType);
        await this.item.setFlag(MODULE_ID, 'encryptionDC', encryptionDC);
        await this.item.setFlag(MODULE_ID, 'encryptionMode', encryptionMode);
        await this.item.setFlag(MODULE_ID, 'allowedSkills', allowedSkills);
        await this.item.setFlag(MODULE_ID, 'skillDCs', skillDCs);
        await this.item.setFlag(MODULE_ID, 'failureMode', failureMode);
        await this.item.setFlag(MODULE_ID, 'singleMessage', singleMessage);
        await this.item.setFlag(MODULE_ID, 'theme', theme);
        await this.item.setFlag(MODULE_ID, 'requiresNetwork', requiresNetwork);
        await this.item.setFlag(MODULE_ID, 'requiredNetwork', requiredNetwork);
        await this.item.setFlag(MODULE_ID, 'requiresLogin', requiresLogin);
        await this.item.setFlag(MODULE_ID, 'loginUsername', loginUsername);
        await this.item.setFlag(MODULE_ID, 'loginPassword', loginPassword);
        await this.item.setFlag(MODULE_ID, 'maxLoginAttempts', maxLoginAttempts);
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