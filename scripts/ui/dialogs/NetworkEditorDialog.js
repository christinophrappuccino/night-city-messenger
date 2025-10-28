/**
 * Network Editor Dialog
 * File: scripts/ui/dialogs/NetworkEditorDialog.js
 * Module: cyberpunkred-messenger
 * Description: Dialog for creating and editing network configurations
 */

import { MODULE_ID, NETWORK_TYPES, SECURITY_LEVELS } from '../../utils/constants.js';

export class NetworkEditorDialog extends Dialog {
  constructor(options = {}) {
    // Store options first
    const mode = options.mode || 'create';
    const network = options.network || NetworkEditorDialog._getDefaultNetwork();
    const onSaveCallback = options.onSave;
    
    const dialogData = {
      title: mode === 'edit' ? 'Edit Network' : 'Create Network',
      content: '<p>Loading...</p>', // Will be replaced in render
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: mode === 'edit' ? 'Update' : 'Create',
          callback: html => {
            // Prevent default dialog close
            return false;
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel'
        }
      },
      default: 'save',
      close: () => {}
    };
    
    super(dialogData, {
      classes: ['ncm-dialog', 'ncm-network-editor'],
      width: 750,
      height: 650,
      resizable: true,
      jQuery: true
    });
    
    this.options.buttons = false; // Hide default dialog buttons
    
    this.mode = mode;
    this.network = network;
    this.onSave = onSaveCallback;
    
    // Validation state
    this.errors = {};
  }
  
  static _getDefaultNetwork() {
    return {
      id: '',
      name: '',
      displayName: '',
      type: 'CUSTOM',
      description: '',
      requiresAuth: false,
      security: {
        level: 'LOW',
        password: '',
        iceDamage: '1d6',
        breachDC: 10
      },
      reliability: 95,
      coverage: {
        global: true,
        scenes: []
      },
      features: {
        anonymous: false,
        encrypted: false,
        traced: false,
        monitored: false
      },
      theme: {
        color: '#F65261',
        icon: 'fa-network-wired'
      },
      enabled: true
    };
  }
  
  async getData() {
    return {
      mode: this.mode,
      network: this.network,
      networkTypes: NETWORK_TYPES,
      securityLevels: SECURITY_LEVELS,
      scenes: game.scenes.map(s => ({ id: s.id, name: s.name })),
      errors: this.errors,
      icons: this._getAvailableIcons()
    };
  }
  
  async _render(force, options) {
    await super._render(force, options);
    
    // Render the template content
    const data = await this.getData();
    const template = `modules/${MODULE_ID}/templates/dialogs/network-editor.hbs`;
    const html = await renderTemplate(template, data);
    
    // Replace the dialog content
    this.element.find('.dialog-content').html(html);
    
    // Activate listeners
    this.activateListeners(this.element);
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
    // Save button
    html.find('.save-network-btn').click(this._onSaveClick.bind(this));
    
    // Cancel button
    html.find('.cancel-network-btn').click(() => this.close());
    
    // Network ID generation
    html.find('input[name="name"]').on('input', this._onNameChange.bind(this));
    
    // Password toggle
    html.find('.toggle-password').click(this._onTogglePassword.bind(this));
    
    // Security level change
    html.find('select[name="security.level"]').change(this._onSecurityLevelChange.bind(this));
    
    // Coverage type change
    html.find('input[name="coverage.global"]').change(this._onCoverageTypeChange.bind(this));
    
    // Color picker
    html.find('input[name="theme.color"]').change(this._onColorChange.bind(this));
    
    // Icon picker
    html.find('.icon-picker-btn').click(this._onIconPicker.bind(this));
    
    // Preview
    html.find('.preview-network').click(this._onPreview.bind(this));
    
    // Templates
    html.find('.load-template-btn').click(this._onLoadTemplate.bind(this));
    
    // Real-time validation
    html.find('input, select, textarea').on('input change', this._validateField.bind(this));
  }
  
  _onNameChange(event) {
    const name = event.target.value;
    
    // Auto-generate ID if creating new network
    if (this.mode === 'create' && name) {
      const idField = this.element.find('input[name="id"]');
      if (!idField.val() || idField.data('auto-generated')) {
        const autoId = name
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '_')
          .replace(/_+/g, '_')
          .substring(0, 32);
        
        idField.val(autoId);
        idField.data('auto-generated', true);
      }
    }
  }
  
  _onTogglePassword(event) {
    event.preventDefault();
    
    const button = $(event.currentTarget);
    const input = button.prev('input');
    
    if (input.attr('type') === 'password') {
      input.attr('type', 'text');
      button.find('i').removeClass('fa-eye').addClass('fa-eye-slash');
    } else {
      input.attr('type', 'password');
      button.find('i').removeClass('fa-eye-slash').addClass('fa-eye');
    }
  }
  
  _onSecurityLevelChange(event) {
    const level = event.target.value;
    
    // Update suggested values
    const suggestions = {
      'NONE': { iceDamage: '0', breachDC: 0 },
      'LOW': { iceDamage: '1d6', breachDC: 10 },
      'MEDIUM': { iceDamage: '2d6', breachDC: 15 },
      'HIGH': { iceDamage: '3d6', breachDC: 20 },
      'EXTREME': { iceDamage: '5d6', breachDC: 25 }
    };
    
    const suggestion = suggestions[level];
    if (suggestion) {
      this.element.find('input[name="security.iceDamage"]').val(suggestion.iceDamage);
      this.element.find('input[name="security.breachDC"]').val(suggestion.breachDC);
    }
  }
  
  _onCoverageTypeChange(event) {
    const isGlobal = event.target.checked;
    const sceneSelector = this.element.find('.scene-selector');
    
    if (isGlobal) {
      sceneSelector.hide();
    } else {
      sceneSelector.show();
    }
  }
  
  _onColorChange(event) {
    const color = event.target.value;
    const preview = this.element.find('.color-preview');
    preview.css('background-color', color);
  }
  
  _onIconPicker(event) {
    event.preventDefault();
    
    // Simple icon picker - could be enhanced with a modal
    const icons = this._getAvailableIcons();
    const currentIcon = this.element.find('input[name="theme.icon"]').val();
    
    const content = `
      <div class="icon-picker-grid">
        ${icons.map(icon => `
          <button type="button" class="icon-option ${icon === currentIcon ? 'selected' : ''}" data-icon="${icon}">
            <i class="fas ${icon}"></i>
          </button>
        `).join('')}
      </div>
    `;
    
    new Dialog({
      title: 'Select Icon',
      content: content,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close'
        }
      },
      render: (html) => {
        html.find('.icon-option').click((e) => {
          const icon = e.currentTarget.dataset.icon;
          this.element.find('input[name="theme.icon"]').val(icon);
          this.element.find('.icon-preview i').attr('class', `fas ${icon}`);
        });
      }
    }, {
      classes: ['ncm-dialog', 'icon-picker-dialog'],
      width: 400
    }).render(true);
  }
  
  async _onPreview(event) {
    event.preventDefault();
    
    const formData = this._getFormData();
    
    // Create preview card
    const preview = await renderTemplate(
      `modules/${MODULE_ID}/templates/network-management/partials/network-card.hbs`,
      { network: formData, preview: true }
    );
    
    new Dialog({
      title: 'Network Preview',
      content: `<div class="network-preview-container">${preview}</div>`,
      buttons: {
        close: {
          label: 'Close'
        }
      }
    }, {
      classes: ['ncm-dialog', 'network-preview-dialog'],
      width: 500
    }).render(true);
  }
  
  async _onLoadTemplate(event) {
    event.preventDefault();
    
    const templates = {
      'corpnet': {
        name: 'Corporate Network',
        type: 'CUSTOM',
        requiresAuth: true,
        security: { level: 'HIGH', password: '', iceDamage: '3d6', breachDC: 20 },
        reliability: 99,
        features: { encrypted: true, monitored: true, traced: true },
        theme: { color: '#0066CC', icon: 'fa-building' }
      },
      'darknet': {
        name: 'Dark Network',
        type: 'CUSTOM',
        requiresAuth: true,
        security: { level: 'EXTREME', password: '', iceDamage: '5d6', breachDC: 25 },
        reliability: 70,
        features: { anonymous: true, encrypted: true },
        theme: { color: '#000000', icon: 'fa-user-secret' }
      },
      'public': {
        name: 'Public Network',
        type: 'CUSTOM',
        requiresAuth: false,
        security: { level: 'NONE', password: '', iceDamage: '0', breachDC: 0 },
        reliability: 85,
        features: { monitored: true },
        theme: { color: '#19f3f7', icon: 'fa-wifi' }
      }
    };
    
    const templateChoices = {
      'corpnet': 'Corporate Network (High Security)',
      'darknet': 'Dark Network (Anonymous)',
      'public': 'Public Network (Open Access)'
    };
    
    const choice = await Dialog.prompt({
      title: 'Load Template',
      content: `
        <form>
          <div class="form-group">
            <label>Select Template:</label>
            <select name="template">
              ${Object.entries(templateChoices).map(([key, label]) => 
                `<option value="${key}">${label}</option>`
              ).join('')}
            </select>
          </div>
        </form>
      `,
      callback: (html) => html.find('select[name="template"]').val()
    });
    
    if (choice && templates[choice]) {
      this.network = { ...this.network, ...templates[choice] };
      await this._render(true);
    }
  }
  
  _validateField(event) {
    const field = event.target;
    const name = field.name;
    const value = field.value;
    
    delete this.errors[name];
    
    // Validation rules
    if (name === 'id') {
      if (!value) {
        this.errors[name] = 'Network ID is required';
      } else if (!/^[A-Z0-9_]+$/.test(value)) {
        this.errors[name] = 'ID must contain only uppercase letters, numbers, and underscores';
      }
    }
    
    if (name === 'name') {
      if (!value || value.length < 3) {
        this.errors[name] = 'Name must be at least 3 characters';
      }
    }
    
    if (name === 'reliability') {
      const num = parseInt(value);
      if (isNaN(num) || num < 0 || num > 100) {
        this.errors[name] = 'Reliability must be between 0 and 100';
      }
    }
    
    if (name === 'security.breachDC') {
      const num = parseInt(value);
      if (isNaN(num) || num < 0 || num > 50) {
        this.errors[name] = 'Breach DC must be between 0 and 50';
      }
    }
    
    // Update UI
    const errorEl = this.element.find(`.field-error[data-field="${name}"]`);
    if (this.errors[name]) {
      errorEl.text(this.errors[name]).show();
      $(field).addClass('error');
    } else {
      errorEl.hide();
      $(field).removeClass('error');
    }
  }
  
  _getFormData() {
    const form = this.element.find('form')[0];
    if (!form) {
      console.error('Form not found!');
      return null;
    }
    
    const formData = new FormData(form);
    
    const data = {
      id: formData.get('id') || '',
      name: formData.get('name') || '',
      displayName: formData.get('displayName') || formData.get('name') || '',
      type: formData.get('type') || 'CUSTOM',
      description: formData.get('description') || '',
      requiresAuth: this.element.find('input[name="requiresAuth"]').is(':checked'),
      security: {
        level: formData.get('security.level') || 'LOW',
        password: formData.get('security.password') || '',
        iceDamage: formData.get('security.iceDamage') || '1d6',
        breachDC: parseInt(formData.get('security.breachDC')) || 10
      },
      reliability: parseInt(formData.get('reliability')) || 95,
      coverage: {
        global: this.element.find('input[name="coverage.global"]').is(':checked'),
        scenes: this.element.find('input[name="coverage.global"]').is(':checked')
          ? []
          : Array.from(this.element.find('input[name="coverage.scenes"]:checked')).map(el => el.value)
      },
      features: {
        anonymous: this.element.find('input[name="features.anonymous"]').is(':checked'),
        encrypted: this.element.find('input[name="features.encrypted"]').is(':checked'),
        traced: this.element.find('input[name="features.traced"]').is(':checked'),
        monitored: this.element.find('input[name="features.monitored"]').is(':checked')
      },
      theme: {
        color: formData.get('theme.color') || '#F65261',
        icon: formData.get('theme.icon') || 'fa-network-wired'
      },
      enabled: this.element.find('input[name="enabled"]').is(':checked')
    };
    
    return data;
  }
  
  _validateForm(data) {
    const errors = {};
    
    // Required fields
    if (!data.id || data.id.trim() === '') {
      errors.id = 'Network ID is required';
    }
    
    if (!data.name || data.name.trim() === '') {
      errors.name = 'Network name is required';
    }
    
    // ID format (only if ID is provided)
    if (data.id && !/^[A-Z0-9_]+$/.test(data.id)) {
      errors.id = 'ID must contain only uppercase letters, numbers, and underscores';
    }
    
    // Name length (only if name is provided)
    if (data.name && data.name.trim().length < 3) {
      errors.name = 'Name must be at least 3 characters';
    }
    
    // Reliability range
    if (isNaN(data.reliability) || data.reliability < 0 || data.reliability > 100) {
      errors.reliability = 'Reliability must be between 0 and 100';
    }
    
    // Breach DC range
    if (isNaN(data.security.breachDC) || data.security.breachDC < 0 || data.security.breachDC > 50) {
      errors['security.breachDC'] = 'Breach DC must be between 0 and 50';
    }
    
    // Password required for auth networks (only if requiresAuth and security level is not NONE)
    if (data.requiresAuth && data.security.level !== 'NONE' && !data.security.password) {
      // Make this a warning, not an error - password is optional
      console.warn('Network requires auth but no password set');
    }
    
    return errors;
  }
  
  async _onSaveClick(event) {
    event.preventDefault();
    
    const formData = this._getFormData();
    console.log('Form Data:', formData);
    
    // Validate
    this.errors = this._validateForm(formData);
    console.log('Validation Errors:', this.errors);
    
    if (Object.keys(this.errors).length > 0) {
      ui.notifications.error('Please fix validation errors');
      console.error('Validation failed:', this.errors);
      
      // Show errors in form
      for (const [field, error] of Object.entries(this.errors)) {
        const errorEl = this.element.find(`.field-error[data-field="${field}"]`);
        errorEl.text(error).show();
        this.element.find(`[name="${field}"]`).addClass('error');
      }
      return;
    }
    
    // Check for duplicate ID in create mode
    if (this.mode === 'create') {
      const existing = await game.nightcity.NetworkStorage.getNetwork(formData.id);
      if (existing) {
        ui.notifications.error(`Network with ID "${formData.id}" already exists`);
        this.errors.id = 'This ID is already in use';
        const errorEl = this.element.find(`.field-error[data-field="id"]`);
        errorEl.text(this.errors.id).show();
        this.element.find(`[name="id"]`).addClass('error');
        return;
      }
    }
    
    // Call the callback
    if (this.onSave) {
      await this.onSave(formData);
    }
    
    // Close the dialog
    this.close();
  }
  
  _getAvailableIcons() {
    return [
      'fa-network-wired',
      'fa-wifi',
      'fa-building',
      'fa-user-secret',
      'fa-satellite-dish',
      'fa-server',
      'fa-globe',
      'fa-shield-alt',
      'fa-lock',
      'fa-unlock',
      'fa-broadcast-tower',
      'fa-signal',
      'fa-rss',
      'fa-ethernet',
      'fa-database',
      'fa-cloud',
      'fa-microchip',
      'fa-plug',
      'fa-bolt',
      'fa-exclamation-triangle'
    ];
  }
}