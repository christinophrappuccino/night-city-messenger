/**
 * Item Inbox Configuration Dialog
 * For configuring items to serve as message inboxes
 */
import { MODULE_ID, TEMPLATES } from './constants.js';
import { getSetting } from './settings.js';

export class ItemInboxConfig extends Application {
  /**
   * @param {Item} item - The item being configured
   * @param {Object} options - Application options
   */
  constructor(item, options = {}) {
    super(options);
    this.item = item;
    
    // Load current configuration from flags
    this.isInbox = item.getFlag(MODULE_ID, 'isInbox') || false;
    this.inboxType = item.getFlag(MODULE_ID, 'inboxType') || 'single';
    this.encrypted = item.getFlag(MODULE_ID, 'encrypted') || false;
    this.skillCheck = item.getFlag(MODULE_ID, 'skillCheck') || getSetting('defaultDecryptionSkill');
    this.dvValue = item.getFlag(MODULE_ID, 'dvValue') || getSetting('defaultEncryptionDV');
    this.failureOutcome = item.getFlag(MODULE_ID, 'failureOutcome') || getSetting('defaultFailureOutcome');
    this.theme = item.getFlag(MODULE_ID, 'theme') || 'default';
  }
  
  /**
   * Default Application configuration
   */
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: `modules/${MODULE_ID}/templates/item-inbox-config.html`,
      title: "Item Inbox Configuration",
      id: "item-inbox-config",
      width: 500,
      height: 500,
      classes: ["item-inbox-config"],
      resizable: false
    });
  }
  
  /**
   * Get data for the template
   */
  getData() {
    return {
      item: this.item,
      isInbox: this.isInbox,
      inboxType: this.inboxType,
      encrypted: this.encrypted,
      skillCheck: this.skillCheck,
      dvValue: this.dvValue,
      failureOutcome: this.failureOutcome,
      theme: this.theme,
      
      // Available options for dropdowns
      skills: {
        'Interface': 'Interface',
        'ElectronicsSecurity': 'Electronics/Security Tech',
        'Cryptography': 'Cryptography',
        'Education': 'Education'
      },
      
      failureOutcomes: {
        'lockout': 'Lockout (Temporary)',
        'traceback': 'Traceback (Alerts Sender)',
        'damage': 'Self-damage (EMP Feedback)',
        'corrupt': 'Corrupt Content (Permanently Delete)'
      },
      
      themes: {
        'default': 'Default',
        'arasaka': 'Arasaka',
        'militech': 'Militech',
        'trauma': 'Trauma Team',
        'scav': 'Scavenger',
        'netwatch': 'NetWatch'
      }
    };
  }

  static show(item) {
    const config = new this(item);
    config.render(true);
    return config;
  }
  
  /**
   * Activate listeners
   * @param {jQuery} html - The rendered HTML
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // This is the key toggle that enables/disables the inbox functionality
    html.find('.inbox-toggle').change(event => {
      const showInbox = $(event.currentTarget).prop('checked');
      html.find('.inbox-options').toggle(showInbox);
    });
    
    // Handle the save button
    html.find('.save-config').click(event => {
      event.preventDefault();
      this._saveConfiguration(html);
    });
    
    // Handle the cancel button
    html.find('.cancel-config').click(event => {
      event.preventDefault();
      this.close();
    });
  }
  
  /**
   * Save the configuration to item flags
   * @param {jQuery} html - The form HTML
   * @private
   */
  async _saveConfiguration(html) {
    // Get the isInbox value from the checkbox
    const isInbox = html.find('.inbox-toggle').prop('checked');
    
    // Prepare update data with just the isInbox flag first
    const updateData = {
      [`flags.${MODULE_ID}.isInbox`]: isInbox
    };
    
    // Only include other options if inbox is enabled
    if (isInbox) {
      // Get other configuration options
      const inboxType = html.find('[name="inbox-type"]:checked').val() || 'single';
      const encrypted = html.find('.encrypted-toggle').prop('checked') || false;
      const theme = html.find('[name="theme"]').val() || 'default';
      
      // Add to update data
      updateData[`flags.${MODULE_ID}.inboxType`] = inboxType;
      updateData[`flags.${MODULE_ID}.encrypted`] = encrypted;
      updateData[`flags.${MODULE_ID}.theme`] = theme;
      
      // Add encryption options if enabled
      if (encrypted) {
        updateData[`flags.${MODULE_ID}.skillCheck`] = html.find('[name="skill-check"]').val();
        updateData[`flags.${MODULE_ID}.dvValue`] = parseInt(html.find('[name="dv-value"]').val());
        updateData[`flags.${MODULE_ID}.failureOutcome`] = html.find('[name="failure-outcome"]').val();
      }
    }
    
    // Update the item
    await this.item.update(updateData);
    
    // After saving, now handle the sheet change
    if (isInbox) {
      // Switch to inbox sheet
      await this.item.setFlag("core", "sheetClass", `${MODULE_ID}.ItemInboxSheet`);
      
      // Ensure the data shard journal exists
      if (game.nightcity?.itemInbox?.ensureDataShardJournal) {
        await game.nightcity.itemInbox.ensureDataShardJournal(this.item);
      }
      
      // Render the new sheet
      this.item.sheet.render(true);
    } else {
      // If disabling inbox, switch back to default sheet
      await this.item.unsetFlag("core", "sheetClass");
      
      // Close this sheet and render the default one
      if (this.item.sheet instanceof game.nightcity.itemInbox.ItemInboxSheet) {
        await this.item.sheet.close();
      }
      
      // Render the default sheet after a brief delay
      setTimeout(() => this.item.sheet.render(true), 100);
    }
    
    // Close the configuration dialog
    this.close();
    
    // Show success notification
    ui.notifications.info(`Item Inbox configuration saved for ${this.item.name}.`);
  }
}