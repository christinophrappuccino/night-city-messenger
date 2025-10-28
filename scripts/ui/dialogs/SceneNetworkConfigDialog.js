/**
 * Scene Network Configuration Dialog
 * File: scripts/ui/dialogs/SceneNetworkConfigDialog.js
 * Module: cyberpunkred-messenger
 * Description: Dialog for configuring scene-specific network overrides
 */

import { MODULE_ID } from '../../utils/constants.js';

export class SceneNetworkConfigDialog extends Dialog {
  
  /**
   * Show the scene network configuration dialog
   * @param {Scene} scene - The scene to configure
   * @param {Object} network - The network to configure
   * @param {Object} currentConfig - Current scene network configuration
   * @returns {Promise<Object|null>} - Updated config or null if cancelled
   */
  static async show(scene, network, currentConfig = {}) {
    return new Promise((resolve) => {
      const dialog = new SceneNetworkConfigDialog(scene, network, currentConfig, resolve);
      dialog.render(true);
    });
  }
  
  /**
   * Constructor
   * @param {Scene} scene - The scene
   * @param {Object} network - The network
   * @param {Object} currentConfig - Current configuration
   * @param {Function} resolve - Promise resolver
   */
  constructor(scene, network, currentConfig, resolve) {
    const config = {
      title: `Configure ${network.name} for ${scene.name}`,
      content: '',
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: 'Save Overrides',
          callback: (html) => this._onSave(html)
        },
        clear: {
          icon: '<i class="fas fa-trash"></i>',
          label: 'Clear Overrides',
          callback: () => this._onClear()
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel',
          callback: () => resolve(null)
        }
      },
      default: 'save',
      close: () => resolve(null),
      render: (html) => this._onRender(html)
    };
    
    super(config);
    
    this.scene = scene;
    this.network = network;
    this.currentConfig = foundry.utils.deepClone(currentConfig);
    this.resolve = resolve;
    this.formData = this._prepareFormData();
  }
  
  /**
   * Prepare form data from current configuration
   * @private
   */
  _prepareFormData() {
    const override = this.currentConfig.override || {};
    
    return {
      // Security overrides
      security: {
        enabled: !!override.security,
        level: override.security?.level || this.network.security.level,
        iceDamage: override.security?.iceDamage || this.network.security.iceDamage,
        breachDC: override.security?.breachDC || this.network.security.breachDC
      },
      
      // Reliability override
      reliability: {
        enabled: override.reliability !== undefined,
        value: override.reliability !== undefined ? override.reliability : this.network.reliability
      },
      
      // Feature overrides
      features: {
        encrypted: {
          enabled: override.features?.encrypted !== undefined,
          value: override.features?.encrypted !== undefined ? 
                 override.features.encrypted : 
                 this.network.features.encrypted
        },
        monitored: {
          enabled: override.features?.monitored !== undefined,
          value: override.features?.monitored !== undefined ? 
                 override.features.monitored : 
                 this.network.features.monitored
        },
        anonymized: {
          enabled: override.features?.anonymized !== undefined,
          value: override.features?.anonymized !== undefined ? 
                 override.features.anonymized : 
                 this.network.features.anonymized
        },
        traced: {
          enabled: override.features?.traced !== undefined,
          value: override.features?.traced !== undefined ? 
                 override.features.traced : 
                 this.network.features.traced
        }
      }
    };
  }
  
  /**
   * Get dialog content HTML
   * @returns {Promise<string>}
   * @private
   */
  async _getContent() {
    const templatePath = `modules/${MODULE_ID}/templates/dialogs/scene-network-config.hbs`;
    
    return await renderTemplate(templatePath, {
      scene: this.scene,
      network: this.network,
      formData: this.formData,
      securityLevels: ['LOW', 'MEDIUM', 'HIGH', 'EXTREME', 'BLACK_ICE']
    });
  }
  
  /**
   * Handle dialog render
   * @param {jQuery} html
   * @private
   */
  async _onRender(html) {
    // Set content
    const content = await this._getContent();
    html.find('.dialog-content').html(content);
    
    // Apply cyberpunk styling
    html.find('.dialog').addClass('ncm-dialog ncm-dialog--scene-config');
    
    // Setup event listeners
    this._setupEventListeners(html);
    
    // Update override states
    this._updateOverrideStates(html);
  }
  
  /**
   * Setup event listeners
   * @param {jQuery} html
   * @private
   */
  _setupEventListeners(html) {
    // Toggle override sections
    html.on('change', '[data-toggle-override]', (event) => {
      this._onToggleOverride(html, event);
    });
    
    // Preview overrides
    html.on('click', '[data-action="preview-overrides"]', () => {
      this._onPreviewOverrides(html);
    });
    
    // Load preset
    html.on('change', '[data-action="load-preset"]', (event) => {
      this._onLoadPreset(html, event);
    });
    
    // Real-time validation
    html.on('input change', 'input, select', () => {
      this._validateForm(html);
    });
  }
  
  /**
   * Toggle override section
   * @param {jQuery} html
   * @param {Event} event
   * @private
   */
  _onToggleOverride(html, event) {
    const checkbox = event.currentTarget;
    const section = checkbox.dataset.toggleOverride;
    const enabled = checkbox.checked;
    
    // Enable/disable corresponding inputs
    html.find(`[data-override-section="${section}"]`)
      .prop('disabled', !enabled)
      .closest('.ncm-form-group')
      .toggleClass('ncm-form-group--disabled', !enabled);
  }
  
  /**
   * Update override states on render
   * @param {jQuery} html
   * @private
   */
  _updateOverrideStates(html) {
    // Trigger change events to update UI
    html.find('[data-toggle-override]').each((i, checkbox) => {
      $(checkbox).trigger('change');
    });
  }
  
  /**
   * Preview overrides
   * @param {jQuery} html
   * @private
   */
  _onPreviewOverrides(html) {
    const formData = this._gatherFormData(html);
    const override = this._buildOverride(formData);
    
    // Show preview in chat
    ChatMessage.create({
      content: `
        <div class="ncm-chat-card">
          <h3><i class="fas fa-cog"></i> Scene Network Override Preview</h3>
          <p><strong>Scene:</strong> ${this.scene.name}</p>
          <p><strong>Network:</strong> ${this.network.name}</p>
          <pre>${JSON.stringify(override, null, 2)}</pre>
        </div>
      `,
      whisper: [game.user.id]
    });
  }
  
  /**
   * Load preset configuration
   * @param {jQuery} html
   * @param {Event} event
   * @private
   */
  _onLoadPreset(html, event) {
    const preset = event.currentTarget.value;
    
    if (!preset) return;
    
    const presets = {
      'combat-zone': {
        security: { enabled: true, level: 'HIGH', breachDC: 20 },
        reliability: { enabled: true, value: 70 },
        features: {
          monitored: { enabled: true, value: true },
          traced: { enabled: true, value: true }
        }
      },
      'corporate-hq': {
        security: { enabled: true, level: 'EXTREME', breachDC: 25, iceDamage: '5d6' },
        reliability: { enabled: true, value: 99 },
        features: {
          encrypted: { enabled: true, value: true },
          monitored: { enabled: true, value: true },
          traced: { enabled: true, value: true }
        }
      },
      'dead-zone': {
        reliability: { enabled: true, value: 0 }
      },
      'public-area': {
        security: { enabled: true, level: 'LOW', breachDC: 8 },
        reliability: { enabled: true, value: 85 }
      }
    };
    
    const presetData = presets[preset];
    if (presetData) {
      this._applyPreset(html, presetData);
    }
  }
  
  /**
   * Apply preset to form
   * @param {jQuery} html
   * @param {Object} presetData
   * @private
   */
  _applyPreset(html, presetData) {
    // Security overrides
    if (presetData.security) {
      html.find('[name="override-security"]').prop('checked', presetData.security.enabled).trigger('change');
      if (presetData.security.level) {
        html.find('[name="security-level"]').val(presetData.security.level);
      }
      if (presetData.security.breachDC) {
        html.find('[name="breach-dc"]').val(presetData.security.breachDC);
      }
      if (presetData.security.iceDamage) {
        html.find('[name="ice-damage"]').val(presetData.security.iceDamage);
      }
    }
    
    // Reliability override
    if (presetData.reliability) {
      html.find('[name="override-reliability"]').prop('checked', presetData.reliability.enabled).trigger('change');
      html.find('[name="reliability-value"]').val(presetData.reliability.value);
    }
    
    // Feature overrides
    if (presetData.features) {
      Object.entries(presetData.features).forEach(([feature, data]) => {
        html.find(`[name="override-${feature}"]`).prop('checked', data.enabled).trigger('change');
        html.find(`[name="${feature}-value"]`).prop('checked', data.value);
      });
    }
    
    // Show success
    ui.notifications.info(`Applied "${presetData.name || 'preset'}" configuration`);
  }
  
  /**
   * Validate form
   * @param {jQuery} html
   * @returns {boolean}
   * @private
   */
  _validateForm(html) {
    let valid = true;
    
    // Validate breach DC (must be 1-30)
    const breachDC = html.find('[name="breach-dc"]');
    if (breachDC.length && breachDC.val()) {
      const value = parseInt(breachDC.val());
      if (value < 1 || value > 30) {
        breachDC.addClass('ncm-input--error');
        valid = false;
      } else {
        breachDC.removeClass('ncm-input--error');
      }
    }
    
    // Validate reliability (0-100)
    const reliability = html.find('[name="reliability-value"]');
    if (reliability.length && reliability.val()) {
      const value = parseInt(reliability.val());
      if (value < 0 || value > 100) {
        reliability.addClass('ncm-input--error');
        valid = false;
      } else {
        reliability.removeClass('ncm-input--error');
      }
    }
    
    return valid;
  }
  
  /**
   * Gather form data
   * @param {jQuery} html
   * @returns {Object}
   * @private
   */
  _gatherFormData(html) {
    return {
      security: {
        enabled: html.find('[name="override-security"]').is(':checked'),
        level: html.find('[name="security-level"]').val(),
        iceDamage: html.find('[name="ice-damage"]').val(),
        breachDC: parseInt(html.find('[name="breach-dc"]').val())
      },
      reliability: {
        enabled: html.find('[name="override-reliability"]').is(':checked'),
        value: parseInt(html.find('[name="reliability-value"]').val())
      },
      features: {
        encrypted: {
          enabled: html.find('[name="override-encrypted"]').is(':checked'),
          value: html.find('[name="encrypted-value"]').is(':checked')
        },
        monitored: {
          enabled: html.find('[name="override-monitored"]').is(':checked'),
          value: html.find('[name="monitored-value"]').is(':checked')
        },
        anonymized: {
          enabled: html.find('[name="override-anonymized"]').is(':checked'),
          value: html.find('[name="anonymized-value"]').is(':checked')
        },
        traced: {
          enabled: html.find('[name="override-traced"]').is(':checked'),
          value: html.find('[name="traced-value"]').is(':checked')
        }
      }
    };
  }
  
  /**
   * Build override object from form data
   * @param {Object} formData
   * @returns {Object|null}
   * @private
   */
  _buildOverride(formData) {
    const override = {};
    
    // Security overrides
    if (formData.security.enabled) {
      override.security = {
        level: formData.security.level
      };
      
      if (formData.security.iceDamage) {
        override.security.iceDamage = formData.security.iceDamage;
      }
      
      if (formData.security.breachDC) {
        override.security.breachDC = formData.security.breachDC;
      }
    }
    
    // Reliability override
    if (formData.reliability.enabled) {
      override.reliability = formData.reliability.value;
    }
    
    // Feature overrides
    const features = {};
    Object.entries(formData.features).forEach(([feature, data]) => {
      if (data.enabled) {
        features[feature] = data.value;
      }
    });
    
    if (Object.keys(features).length > 0) {
      override.features = features;
    }
    
    // Return null if no overrides enabled
    return Object.keys(override).length > 0 ? override : null;
  }
  
  /**
   * Handle save button
   * @param {jQuery} html
   * @returns {Object}
   * @private
   */
  _onSave(html) {
    // Validate
    if (!this._validateForm(html)) {
      ui.notifications.error('Please correct the errors in the form');
      return false;
    }
    
    // Gather form data
    const formData = this._gatherFormData(html);
    
    // Build override object
    const override = this._buildOverride(formData);
    
    // Build complete config
    const config = {
      available: this.currentConfig.available !== false,
      signalStrength: this.currentConfig.signalStrength || 100,
      override: override
    };
    
    // Resolve with config
    this.resolve(config);
    
    // Show success
    ui.notifications.success('Scene network overrides saved');
    
    return config;
  }
  
  /**
   * Handle clear button
   * @returns {Object}
   * @private
   */
  _onClear() {
    const config = {
      available: this.currentConfig.available !== false,
      signalStrength: this.currentConfig.signalStrength || 100,
      override: null
    };
    
    this.resolve(config);
    
    ui.notifications.info('Scene network overrides cleared');
    
    return config;
  }
  
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['dialog', 'ncm-dialog', 'ncm-dialog--scene-config'],
      width: 600,
      height: 'auto',
      jQuery: true
    });
  }
}