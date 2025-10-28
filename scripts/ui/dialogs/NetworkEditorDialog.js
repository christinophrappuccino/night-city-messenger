/**
 * Network Editor Dialog
 * File: scripts/ui/dialogs/NetworkEditorDialog.js
 * Module: cyberpunkred-messenger
 * Description: Dialog for creating and editing network configurations
 */

import { MODULE_ID, NETWORK_TYPES, SECURITY_LEVELS } from '../../utils/constants.js';

export class NetworkEditorDialog extends Dialog {
  constructor(options = {}) {
    const dialogData = {
      title: options.mode === 'edit' ? 'Edit Network' : 'Create Network',
      content: '',
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: options.mode === 'edit' ? 'Update' : 'Create',
          callback: html => this._onSave(html)
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
      width: 700,
      height: 'auto',
      jQuery: true
    });
    
    this.mode = options.mode || 'create';
    this.network = options.network || this._getDefaultNetwork();
    this.onSave = options.onSave;
    
    // Validation state
    this.errors = {};
  }
  
  _getDefaultNetwork() {
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
    
    this.element.find('.dialog-content').html(html);
    this.activateListeners(this.element);
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
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
    const formData = new FormData(form);
    
    const data = {
      id: formData.get('id'),
      name: formData.get('name'),
      displayName: formData.get('displayName') || formData.get('name'),
      type: formData.get('type'),
      description: formData.get('description'),
      requiresAuth: formData.get('requiresAuth') === 'on',
      security: {
        level: formData.get('security.level'),
        password: formData.get('security.password'),
        iceDamage: formData.get('security.iceDamage'),
        breachDC: parseInt(formData.get('security.breachDC'))
      },
      reliability: parseInt(formData.get('reliability')),
      coverage: {
        global: formData.get('coverage.global') === 'on',
        scenes: formData.get('coverage.global') !== 'on' 
          ? Array.from(formData.getAll('coverage.scenes'))
          : []
      },
      features: {
        anonymous: formData.get('features.anonymous') === 'on',
        encrypted: formData.get('features.encrypted') === 'on',
        traced: formData.get('features.traced') === 'on',
        monitored: formData.get('features.monitored') === 'on'
      },
      theme: {
        color: formData.get('theme.color'),
        icon: formData.get('theme.icon')
      },
      enabled: formData.get('enabled') === 'on'
    };
    
    return data;
  }
  
  _validateForm(data) {
    const errors = {};
    
    // Required fields
    if (!data.id) errors.id = 'Network ID is required';
    if (!data.name) errors.name = 'Network name is required';
    
    // ID format
    if (data.id && !/^[A-Z0-9_]+$/.test(data.id)) {
      errors.id = 'ID must contain only uppercase letters, numbers, and underscores';
    }
    
    // Name length
    if (data.name && data.name.length < 3) {
      errors.name = 'Name must be at least 3 characters';
    }
    
    // Reliability range
    if (data.reliability < 0 || data.reliability > 100) {
      errors.reliability = 'Reliability must be between 0 and 100';
    }
    
    // Breach DC range
    if (data.security.breachDC < 0 || data.security.breachDC > 50) {
      errors['security.breachDC'] = 'Breach DC must be between 0 and 50';
    }
    
    // Password required for auth networks
    if (data.requiresAuth && data.security.level !== 'NONE' && !data.security.password) {
      errors['security.password'] = 'Password required for authenticated networks';
    }
    
    // Check for duplicate ID (only for create mode)
    if (this.mode === 'create') {
      // This will be checked async in _onSave
    }
    
    return errors;
  }
  
  async _onSave(html) {
    const formData = this._getFormData();
    
    // Validate
    this.errors = this._validateForm(formData);
    
    if (Object.keys(this.errors).length > 0) {
      ui.notifications.error('Please fix validation errors');
      await this._render(true);
      return;
    }
    
    // Check for duplicate ID in create mode
    if (this.mode === 'create') {
      const existing = await game.nightcity.NetworkStorage.getNetwork(formData.id);
      if (existing) {
        ui.notifications.error(`Network with ID "${formData.id}" already exists`);
        this.errors.id = 'This ID is already in use';
        await this._render(true);
        return;
      }
    }
    
    // Call the callback
    if (this.onSave) {
      await this.onSave(formData);
    }
    
    return formData;
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