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
    // Prepare form data
    const formData = SceneNetworkConfigDialog._prepareFormData(network, currentConfig);
    
    const config = {
      title: `Configure ${network.name} for ${scene.name}`,
      content: '', // Will be set in getData
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: 'Save Overrides',
          callback: (html) => {
            const result = SceneNetworkConfigDialog._gatherFormData(html, currentConfig);
            resolve(result);
            return result;
          }
        },
        clear: {
          icon: '<i class="fas fa-trash"></i>',
          label: 'Clear All Overrides',
          callback: () => {
            // Return config with no overrides
            resolve({
              available: currentConfig.available !== undefined ? currentConfig.available : true,
              signalStrength: currentConfig.signalStrength || 100,
              override: null
            });
            return true;
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel',
          callback: () => {
            resolve(null);
            return null;
          }
        }
      },
      default: 'save',
      close: () => resolve(null),
      render: async (html) => {
        await SceneNetworkConfigDialog._onRender(html, scene, network, formData);
      }
    };
    
    super(config);
    
    this.scene = scene;
    this.network = network;
    this.currentConfig = foundry.utils.deepClone(currentConfig);
    this.formData = formData;
    this.resolve = resolve;
    
    // Override content getter
    this.options.content = this._getContent.bind(this);
  }
  
  /**
   * Get dialog content HTML
   * @private
   */
  _getContent() {
    return `
      <div class="ncm-scene-config-dialog">
        
        <!-- Scene/Network Info -->
        <div class="ncm-info-card">
          <div class="ncm-info-card__row">
            <span class="ncm-info-card__label">
              <i class="fas fa-map-marker-alt"></i> Scene:
            </span>
            <span class="ncm-info-card__value">${this.scene.name}</span>
          </div>
          <div class="ncm-info-card__row">
            <span class="ncm-info-card__label">
              <i class="${this.network.theme.icon}" style="color: ${this.network.theme.color}"></i> Network:
            </span>
            <span class="ncm-info-card__value">${this.network.name}</span>
          </div>
        </div>
        
        <p class="ncm-hint">
          <i class="fas fa-info-circle"></i>
          Configure scene-specific overrides for this network. Leave sections disabled to use network defaults.
        </p>
        
        <div class="ncm-divider"></div>
        
        <!-- Preset Selector -->
        <div class="ncm-form-group">
          <label class="ncm-label">
            <i class="fas fa-magic"></i> Quick Presets
          </label>
          <select class="ncm-select" data-action="load-preset">
            <option value="">-- Select a preset --</option>
            <option value="combat-zone">Combat Zone (High Security, Monitored)</option>
            <option value="corporate-hq">Corporate HQ (Extreme Security)</option>
            <option value="dead-zone">Dead Zone (No Signal)</option>
            <option value="public-area">Public Area (Low Security)</option>
          </select>
        </div>
        
        <div class="ncm-divider"></div>
        
        <!-- Security Overrides -->
        <div class="ncm-override-section">
          <div class="ncm-override-section__header">
            <label class="ncm-checkbox">
              <input type="checkbox" 
                     name="override-security" 
                     data-toggle-override="security"
                     ${this.formData.security.enabled ? 'checked' : ''}>
              <span class="ncm-checkbox__label">
                <i class="fas fa-shield-alt"></i> Override Security Settings
              </span>
            </label>
          </div>
          
          <div class="ncm-override-section__body">
            <div class="ncm-form-group">
              <label class="ncm-label">Security Level</label>
              <select class="ncm-select" name="security-level" data-override-section="security">
                <option value="NONE" ${this.formData.security.level === 'NONE' ? 'selected' : ''}>None</option>
                <option value="LOW" ${this.formData.security.level === 'LOW' ? 'selected' : ''}>Low</option>
                <option value="MEDIUM" ${this.formData.security.level === 'MEDIUM' ? 'selected' : ''}>Medium</option>
                <option value="HIGH" ${this.formData.security.level === 'HIGH' ? 'selected' : ''}>High</option>
                <option value="EXTREME" ${this.formData.security.level === 'EXTREME' ? 'selected' : ''}>Extreme</option>
                <option value="BLACK_ICE" ${this.formData.security.level === 'BLACK_ICE' ? 'selected' : ''}>BLACK ICE</option>
              </select>
            </div>
            
            <div class="ncm-form-row">
              <div class="ncm-form-group">
                <label class="ncm-label">ICE Damage</label>
                <input type="text" 
                       class="ncm-input" 
                       name="security-ice-damage" 
                       value="${this.formData.security.iceDamage}"
                       placeholder="e.g., 3d6"
                       data-override-section="security">
              </div>
              
              <div class="ncm-form-group">
                <label class="ncm-label">Breach DC</label>
                <input type="number" 
                       class="ncm-input" 
                       name="security-breach-dc" 
                       value="${this.formData.security.breachDC}"
                       min="6"
                       max="30"
                       data-override-section="security">
              </div>
            </div>
          </div>
        </div>
        
        <div class="ncm-divider"></div>
        
        <!-- Reliability Override -->
        <div class="ncm-override-section">
          <div class="ncm-override-section__header">
            <label class="ncm-checkbox">
              <input type="checkbox" 
                     name="override-reliability" 
                     data-toggle-override="reliability"
                     ${this.formData.reliability.enabled ? 'checked' : ''}>
              <span class="ncm-checkbox__label">
                <i class="fas fa-signal"></i> Override Reliability
              </span>
            </label>
          </div>
          
          <div class="ncm-override-section__body">
            <div class="ncm-form-group">
              <label class="ncm-label">Reliability (%)</label>
              <div class="ncm-input-with-slider">
                <input type="range" 
                       class="ncm-range" 
                       name="reliability-value" 
                       min="0" 
                       max="100" 
                       step="5" 
                       value="${this.formData.reliability.value}"
                       data-override-section="reliability">
                <input type="number" 
                       class="ncm-input ncm-input--sm" 
                       name="reliability-value-display" 
                       min="0" 
                       max="100" 
                       value="${this.formData.reliability.value}"
                       data-override-section="reliability">
              </div>
              <p class="ncm-hint">Chance of successful connection/transmission (0-100%)</p>
            </div>
          </div>
        </div>
        
        <div class="ncm-divider"></div>
        
        <!-- Feature Overrides -->
        <div class="ncm-override-section">
          <div class="ncm-override-section__header">
            <h4 class="ncm-section-title">
              <i class="fas fa-cog"></i> Network Feature Overrides
            </h4>
            <p class="ncm-hint">Override specific network features for this scene</p>
          </div>
          
          <div class="ncm-override-section__body">
            
            <!-- Encrypted -->
            <div class="ncm-feature-override">
              <label class="ncm-checkbox">
                <input type="checkbox" 
                       name="override-encrypted" 
                       data-toggle-override="encrypted"
                       ${this.formData.features.encrypted.enabled ? 'checked' : ''}>
                <span class="ncm-checkbox__label">
                  <i class="fas fa-lock"></i> Override Encryption
                </span>
              </label>
              <div class="ncm-feature-override__control">
                <label class="ncm-toggle">
                  <input type="checkbox" 
                         name="feature-encrypted" 
                         data-override-section="encrypted"
                         ${this.formData.features.encrypted.value ? 'checked' : ''}>
                  <span class="ncm-toggle__slider"></span>
                </label>
              </div>
            </div>
            
            <!-- Monitored -->
            <div class="ncm-feature-override">
              <label class="ncm-checkbox">
                <input type="checkbox" 
                       name="override-monitored" 
                       data-toggle-override="monitored"
                       ${this.formData.features.monitored.enabled ? 'checked' : ''}>
                <span class="ncm-checkbox__label">
                  <i class="fas fa-eye"></i> Override Monitoring
                </span>
              </label>
              <div class="ncm-feature-override__control">
                <label class="ncm-toggle">
                  <input type="checkbox" 
                         name="feature-monitored" 
                         data-override-section="monitored"
                         ${this.formData.features.monitored.value ? 'checked' : ''}>
                  <span class="ncm-toggle__slider"></span>
                </label>
              </div>
            </div>
            
            <!-- Traced -->
            <div class="ncm-feature-override">
              <label class="ncm-checkbox">
                <input type="checkbox" 
                       name="override-traced" 
                       data-toggle-override="traced"
                       ${this.formData.features.traced.enabled ? 'checked' : ''}>
                <span class="ncm-checkbox__label">
                  <i class="fas fa-route"></i> Override Tracing
                </span>
              </label>
              <div class="ncm-feature-override__control">
                <label class="ncm-toggle">
                  <input type="checkbox" 
                         name="feature-traced" 
                         data-override-section="traced"
                         ${this.formData.features.traced.value ? 'checked' : ''}>
                  <span class="ncm-toggle__slider"></span>
                </label>
              </div>
            </div>
            
          </div>
        </div>
        
      </div>
    `;
  }
  
  /**
   * Prepare form data from current configuration
   * @private
   * @static
   */
  static _prepareFormData(network, currentConfig) {
    const override = currentConfig.override || {};
    
    return {
      // Security overrides
      security: {
        enabled: !!override.security,
        level: override.security?.level || network.security?.level || 'MEDIUM',
        iceDamage: override.security?.iceDamage || network.security?.iceDamage || '3d6',
        breachDC: override.security?.breachDC || network.security?.breachDC || 15
      },
      
      // Reliability override
      reliability: {
        enabled: override.reliability !== undefined,
        value: override.reliability !== undefined ? override.reliability : (network.reliability || 95)
      },
      
      // Feature overrides
      features: {
        encrypted: {
          enabled: override.features?.encrypted !== undefined,
          value: override.features?.encrypted !== undefined ? override.features.encrypted : (network.features?.encrypted || false)
        },
        monitored: {
          enabled: override.features?.monitored !== undefined,
          value: override.features?.monitored !== undefined ? override.features.monitored : (network.features?.monitored || false)
        },
        traced: {
          enabled: override.features?.traced !== undefined,
          value: override.features?.traced !== undefined ? override.features.traced : (network.features?.traced || false)
        }
      }
    };
  }
  
  /**
   * Gather form data when saving
   * @private
   * @static
   */
  static _gatherFormData(html, currentConfig) {
    const override = {};
    
    // Security override
    if (html.find('[name="override-security"]').is(':checked')) {
      override.security = {
        level: html.find('[name="security-level"]').val(),
        iceDamage: html.find('[name="security-ice-damage"]').val(),
        breachDC: parseInt(html.find('[name="security-breach-dc"]').val())
      };
    }
    
    // Reliability override
    if (html.find('[name="override-reliability"]').is(':checked')) {
      override.reliability = parseInt(html.find('[name="reliability-value"]').val());
    }
    
    // Feature overrides
    const features = {};
    
    if (html.find('[name="override-encrypted"]').is(':checked')) {
      features.encrypted = html.find('[name="feature-encrypted"]').is(':checked');
    }
    
    if (html.find('[name="override-monitored"]').is(':checked')) {
      features.monitored = html.find('[name="feature-monitored"]').is(':checked');
    }
    
    if (html.find('[name="override-traced"]').is(':checked')) {
      features.traced = html.find('[name="feature-traced"]').is(':checked');
    }
    
    if (Object.keys(features).length > 0) {
      override.features = features;
    }
    
    // Return full config
    return {
      available: currentConfig.available !== undefined ? currentConfig.available : true,
      signalStrength: currentConfig.signalStrength || 100,
      override: Object.keys(override).length > 0 ? override : null
    };
  }
  
  /**
   * Handle render
   * @private
   * @static
   */
  static async _onRender(html, scene, network, formData) {
    // Enable/disable override sections based on checkboxes
    html.find('[data-toggle-override]').on('change', function() {
      const section = $(this).data('toggle-override');
      const enabled = $(this).is(':checked');
      
      html.find(`[data-override-section="${section}"]`)
        .prop('disabled', !enabled)
        .closest('.ncm-form-group, .ncm-feature-override__control')
        .toggleClass('disabled', !enabled);
    });
    
    // Trigger initial state
    html.find('[data-toggle-override]').trigger('change');
    
    // Sync range slider with number input
    html.find('[name="reliability-value"]').on('input', function() {
      html.find('[name="reliability-value-display"]').val($(this).val());
    });
    
    html.find('[name="reliability-value-display"]').on('change', function() {
      html.find('[name="reliability-value"]').val($(this).val());
    });
    
    // Preset selector
    html.find('[data-action="load-preset"]').on('change', function() {
      const preset = $(this).val();
      
      if (!preset) return;
      
      const presets = {
        'combat-zone': {
          security: { enabled: true, level: 'HIGH', breachDC: 20, iceDamage: '4d6' },
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
            monitored: { enabled: true, value: true }
          }
        },
        'dead-zone': {
          security: { enabled: false },
          reliability: { enabled: true, value: 0 },
          features: {}
        },
        'public-area': {
          security: { enabled: true, level: 'LOW', breachDC: 10, iceDamage: '2d6' },
          reliability: { enabled: true, value: 95 },
          features: {
            encrypted: { enabled: true, value: false },
            monitored: { enabled: true, value: false }
          }
        }
      };
      
      const config = presets[preset];
      if (!config) return;
      
      // Apply security
      if (config.security?.enabled) {
        html.find('[name="override-security"]').prop('checked', true);
        html.find('[name="security-level"]').val(config.security.level);
        html.find('[name="security-breach-dc"]').val(config.security.breachDC);
        html.find('[name="security-ice-damage"]').val(config.security.iceDamage);
      } else {
        html.find('[name="override-security"]').prop('checked', false);
      }
      
      // Apply reliability
      if (config.reliability?.enabled) {
        html.find('[name="override-reliability"]').prop('checked', true);
        html.find('[name="reliability-value"]').val(config.reliability.value);
        html.find('[name="reliability-value-display"]').val(config.reliability.value);
      } else {
        html.find('[name="override-reliability"]').prop('checked', false);
      }
      
      // Apply features
      ['encrypted', 'monitored', 'traced'].forEach(feature => {
        if (config.features[feature]?.enabled !== undefined) {
          html.find(`[name="override-${feature}"]`).prop('checked', config.features[feature].enabled);
          html.find(`[name="feature-${feature}"]`).prop('checked', config.features[feature].value);
        } else {
          html.find(`[name="override-${feature}"]`).prop('checked', false);
        }
      });
      
      // Trigger change events to update UI
      html.find('[data-toggle-override]').trigger('change');
      
      ui.notifications.info(`Applied "${preset}" preset`);
    });
  }
}