/**
 * Network Editor Dialog
 * File: scripts/ui/dialogs/NetworkEditorDialog.js
 * Module: cyberpunkred-messenger
 * Description: Dialog for creating and editing network definitions
 * 
 * Features:
 * - Create new networks with templates
 * - Edit existing networks
 * - Duplicate networks
 * - Live preview
 * - Collapsible sections
 * - Icon picker
 * - Color picker with presets
 * - Security configuration
 * - Form validation
 */

import { MODULE_ID } from '../../utils/constants.js';

export class NetworkEditorDialog extends Application {
  
  constructor(options = {}) {
    super(options);
    
    this.mode = options.mode || 'create'; // 'create', 'edit', 'duplicate'
    this.network = this._initializeNetwork(options.network);
    this.onSave = options.onSave || null;
    this.onDelete = options.onDelete || null;
    this.errors = {};
    
    // Track expanded sections
    this.expandedSections = new Set(['identity']);
  }
  
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'ncm-network-editor',
      template: `modules/${MODULE_ID}/templates/dialogs/network-editor.hbs`,
      classes: ['ncm-app', 'ncm-network-editor-dialog'],
      width: 650,
      height: 'auto',
      title: '⚡ Network Editor',
      resizable: true,
      minimizable: true
    });
  }
  
  get title() {
    const titles = {
      'create': '⚡ Create New Network',
      'edit': `⚡ Edit Network: ${this.network.name}`,
      'duplicate': '⚡ Duplicate Network'
    };
    return titles[this.mode] || '⚡ Network Editor';
  }
  
  /**
   * Initialize network with defaults
   * @param {Object|null} network - Existing network or null
   * @returns {Object} Network data with defaults
   */
  _initializeNetwork(network) {
    const defaults = {
      id: '',
      name: '',
      type: 'custom',
      enabled: true,
      description: '',
      signalStrength: 90,
      reliability: 95,
      security: {
        level: 'none',
        requiresAuth: false,
        password: '',
        breachDC: 0,
        attempts: 3,
        lockoutDuration: 300000,
        iceDamage: ''
      },
      effects: {
        messageDelay: 0,
        traced: false,
        anonymity: false,
        canRoute: true
      },
      theme: {
        color: '#19f3f7',
        icon: 'fa-wifi',
        glitchIntensity: 0.2
      },
      hidden: false,
      gmNotes: ''
    };
    
    if (network) {
      return foundry.utils.mergeObject(defaults, network, { recursive: true });
    }
    
    return defaults;
  }
  
  async getData() {
    const data = await super.getData();
    
    return {
      ...data,
      mode: this.mode,
      network: this.network,
      errors: this.errors,
      expandedSections: Array.from(this.expandedSections),
      networkTypes: this._getNetworkTypes(),
      securityLevels: this._getSecurityLevels()
    };
  }
  
  _getNetworkTypes() {
    return [
      { value: 'public', label: '📡 Public' },
      { value: 'corporate', label: '🏢 Corporate' },
      { value: 'darknet', label: '🕵️ Darknet' },
      { value: 'military', label: '🎖️ Military' },
      { value: 'custom', label: '⚡ Custom' }
    ];
  }
  
  _getSecurityLevels() {
    return [
      { value: 'none', label: '🔓 None (Open Access)', breachDC: 0 },
      { value: 'low', label: '🔒 Low', breachDC: 10 },
      { value: 'medium', label: '🔐 Medium', breachDC: 15 },
      { value: 'high', label: '🛡️ High', breachDC: 20 },
      { value: 'extreme', label: '⚠️ Extreme', breachDC: 25 },
      { value: 'black-ice', label: '💀 BLACK ICE (Lethal)', breachDC: 30 }
    ];
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
    // Section toggles
    html.find('.ncm-editor-section__header').click(this._onToggleSection.bind(this));
    
    // Auto-generate ID from name
    html.find('input[name="name"]').on('input', this._onNameInput.bind(this));
    
    // Character counters
    html.find('textarea[maxlength]').on('input', this._updateCharCounter.bind(this));
    this._initCharCounters(html);
    
    // Slider value displays
    html.find('input[type="range"]').on('input', this._onSliderInput.bind(this));
    this._initSliderValues(html);
    
    // Quick icon picker
    html.find('.quick-icon').click(this._onQuickIconClick.bind(this));
    html.find('.open-icon-picker-btn').click(this._onOpenIconPicker.bind(this));
    
    // Color picker
    html.find('input[name="theme.color"]').on('input', this._onColorInput.bind(this));
    html.find('.color-hex-input').on('change', this._onColorHexChange.bind(this));
    html.find('.color-preset').click(this._onColorPresetClick.bind(this));
    
    // Security toggle
    html.find('.security-master-toggle').change(this._onSecurityToggle.bind(this));
    html.find('.security-level-select').change(this._onSecurityLevelChange.bind(this));
    
    // Password controls
    html.find('.toggle-password-btn').click(this._onTogglePassword.bind(this));
    html.find('.generate-password-btn').click(this._onGeneratePassword.bind(this));
    
    // Form submission
    html.find('form').on('submit', this._onSubmit.bind(this));
    html.find('.save-btn').click(this._onSubmit.bind(this));
    html.find('.cancel-btn').click(() => this.close());
    
    // Delete (edit mode only)
    html.find('.delete-network-btn').click(this._onDelete.bind(this));
    
    // Preview
    html.find('.preview-btn').click(this._onPreview.bind(this));
    
    // Enable/disable toggle in header
    html.find('input[name="enabled"]').change(this._onEnabledChange.bind(this));
    
    // Real-time preview updates
    html.find('input, select, textarea').on('change input', this._updateLivePreview.bind(this));
    
    // Initialize sections state
    this._initSections(html);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  
  _initSections(html) {
    html.find('.ncm-editor-section').each((i, el) => {
      const section = el.dataset.section;
      if (this.expandedSections.has(section)) {
        $(el).addClass('ncm-editor-section--expanded');
      }
    });
  }
  
  _onToggleSection(event) {
    event.preventDefault();
    const section = $(event.currentTarget).closest('.ncm-editor-section');
    const sectionName = section.data('section');
    
    section.toggleClass('ncm-editor-section--expanded');
    
    if (section.hasClass('ncm-editor-section--expanded')) {
      this.expandedSections.add(sectionName);
    } else {
      this.expandedSections.delete(sectionName);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // NAME/ID AUTO-GENERATION
  // ═══════════════════════════════════════════════════════════════════════════
  
  _onNameInput(event) {
    const name = event.target.value;
    const idField = this.element.find('input[name="id"]');
    
    // Auto-generate ID only in create mode and if not manually edited
    if (this.mode === 'create' && !idField.data('manual-edit')) {
      const autoId = this._generateId(name);
      idField.val(autoId);
    }
    
    // Update live preview
    this._updateLivePreview();
  }
  
  _generateId(name) {
    if (!name) return '';
    
    return name
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 32);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CHARACTER COUNTERS
  // ═══════════════════════════════════════════════════════════════════════════
  
  _initCharCounters(html) {
    html.find('textarea[maxlength]').each((i, el) => {
      const counter = html.find(`.char-counter[data-target="${el.id}"] .current`);
      if (counter.length) {
        counter.text(el.value.length);
      }
    });
  }
  
  _updateCharCounter(event) {
    const textarea = event.target;
    const counter = this.element.find(`.char-counter[data-target="${textarea.id}"] .current`);
    if (counter.length) {
      counter.text(textarea.value.length);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SLIDERS
  // ═══════════════════════════════════════════════════════════════════════════
  
  _initSliderValues(html) {
    html.find('input[type="range"]').each((i, el) => {
      this._updateSliderDisplay(el);
    });
  }
  
  _onSliderInput(event) {
    this._updateSliderDisplay(event.target);
  }
  
  _updateSliderDisplay(slider) {
    const valueDisplay = this.element.find(`.slider-value[data-target="${slider.id}"]`);
    if (valueDisplay.length) {
      let value = slider.value;
      
      // Add suffix based on field
      if (slider.name.includes('Strength') || slider.name.includes('reliability')) {
        value += '%';
      } else if (slider.name.includes('Delay')) {
        value += 's';
      }
      
      valueDisplay.text(value);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // ICON PICKER
  // ═══════════════════════════════════════════════════════════════════════════
  
  _onQuickIconClick(event) {
    event.preventDefault();
    const btn = $(event.currentTarget);
    const icon = btn.data('icon');
    
    // Update hidden input
    this.element.find('input[name="theme.icon"]').val(icon);
    
    // Update preview
    this.element.find('.icon-preview i').attr('class', `fas ${icon}`);
    
    // Update active state
    this.element.find('.quick-icon').removeClass('active');
    btn.addClass('active');
    
    this._updateLivePreview();
  }
  
  async _onOpenIconPicker(event) {
    event.preventDefault();
    
    const icons = this._getAvailableIcons();
    const currentIcon = this.element.find('input[name="theme.icon"]').val();
    
    const content = `
      <div class="ncm-icon-picker">
        <div class="icon-search">
          <input type="text" placeholder="Search icons..." class="icon-search-input">
        </div>
        <div class="icon-grid">
          ${icons.map(icon => `
            <button type="button" 
                    class="icon-option ${icon === currentIcon ? 'active' : ''}" 
                    data-icon="${icon}"
                    title="${icon}">
              <i class="fas ${icon}"></i>
            </button>
          `).join('')}
        </div>
      </div>
    `;
    
    const dialog = new Dialog({
      title: 'Select Network Icon',
      content: content,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close'
        }
      },
      render: (html) => {
        // Search filter
        html.find('.icon-search-input').on('input', (e) => {
          const filter = e.target.value.toLowerCase();
          html.find('.icon-option').each((i, el) => {
            const icon = el.dataset.icon.toLowerCase();
            $(el).toggle(icon.includes(filter));
          });
        });
        
        // Icon selection
        html.find('.icon-option').click((e) => {
          const icon = e.currentTarget.dataset.icon;
          this.element.find('input[name="theme.icon"]').val(icon);
          this.element.find('.icon-preview i').attr('class', `fas ${icon}`);
          this.element.find('.quick-icon').removeClass('active');
          this.element.find(`.quick-icon[data-icon="${icon}"]`).addClass('active');
          this._updateLivePreview();
          dialog.close();
        });
      }
    }, {
      classes: ['ncm-dialog', 'ncm-icon-picker-dialog'],
      width: 450,
      height: 400
    });
    
    dialog.render(true);
  }
  
  _getAvailableIcons() {
    return [
      // Network & Communication
      'fa-wifi', 'fa-network-wired', 'fa-broadcast-tower', 'fa-satellite-dish',
      'fa-signal', 'fa-rss', 'fa-tower-broadcast', 'fa-satellite',
      // Buildings & Corporate
      'fa-building', 'fa-city', 'fa-hotel', 'fa-warehouse',
      'fa-hospital', 'fa-store', 'fa-industry', 'fa-landmark',
      // Security & Military
      'fa-shield-alt', 'fa-lock', 'fa-unlock', 'fa-key',
      'fa-user-shield', 'fa-user-secret', 'fa-mask', 'fa-bomb',
      'fa-crosshairs', 'fa-skull-crossbones', 'fa-radiation',
      // Tech
      'fa-server', 'fa-database', 'fa-microchip', 'fa-memory',
      'fa-hdd', 'fa-laptop', 'fa-desktop', 'fa-terminal',
      'fa-code', 'fa-bug', 'fa-robot', 'fa-vr-cardboard',
      // Symbols
      'fa-bolt', 'fa-star', 'fa-crown', 'fa-gem',
      'fa-fire', 'fa-snowflake', 'fa-biohazard', 'fa-atom',
      // Other
      'fa-globe', 'fa-map-marker-alt', 'fa-eye', 'fa-eye-slash',
      'fa-ghost', 'fa-skull', 'fa-spider', 'fa-dragon'
    ];
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // COLOR PICKER
  // ═══════════════════════════════════════════════════════════════════════════
  
  _onColorInput(event) {
    const color = event.target.value;
    this.element.find('.color-hex-input').val(color);
    this.element.find('.icon-preview').css('color', color);
    this._updateColorPresetActive(color);
    this._updateLivePreview();
  }
  
  _onColorHexChange(event) {
    let color = event.target.value;
    
    // Ensure it starts with #
    if (!color.startsWith('#')) {
      color = '#' + color;
    }
    
    // Validate hex format
    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
      this.element.find('input[name="theme.color"]').val(color);
      this.element.find('.icon-preview').css('color', color);
      this._updateColorPresetActive(color);
      this._updateLivePreview();
    }
  }
  
  _onColorPresetClick(event) {
    event.preventDefault();
    const btn = $(event.currentTarget);
    const color = btn.data('color');
    
    this.element.find('input[name="theme.color"]').val(color);
    this.element.find('.color-hex-input').val(color);
    this.element.find('.icon-preview').css('color', color);
    this._updateColorPresetActive(color);
    this._updateLivePreview();
  }
  
  _updateColorPresetActive(color) {
    this.element.find('.color-preset').removeClass('active');
    this.element.find(`.color-preset[data-color="${color}"]`).addClass('active');
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITY
  // ═══════════════════════════════════════════════════════════════════════════
  
  _onSecurityToggle(event) {
    const enabled = event.target.checked;
    const settings = this.element.find('.security-settings');
    
    if (enabled) {
      settings.removeClass('security-settings--hidden');
    } else {
      settings.addClass('security-settings--hidden');
    }
  }
  
  _onSecurityLevelChange(event) {
    const level = event.target.value;
    
    // Suggested values for each level
    const suggestions = {
      'none': { breachDC: 0, iceDamage: '' },
      'low': { breachDC: 10, iceDamage: '1d6' },
      'medium': { breachDC: 15, iceDamage: '2d6' },
      'high': { breachDC: 20, iceDamage: '3d6' },
      'extreme': { breachDC: 25, iceDamage: '4d6' },
      'black-ice': { breachDC: 30, iceDamage: '5d6' }
    };
    
    const suggestion = suggestions[level];
    if (suggestion) {
      this.element.find('input[name="security.breachDC"]').val(suggestion.breachDC);
      this.element.find('input[name="security.iceDamage"]').val(suggestion.iceDamage);
    }
    
    // Show/hide BLACK ICE warning
    const dangerZone = this.element.find('.danger-zone');
    if (level === 'black-ice') {
      dangerZone.show();
    } else {
      dangerZone.hide();
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PASSWORD
  // ═══════════════════════════════════════════════════════════════════════════
  
  _onTogglePassword(event) {
    event.preventDefault();
    const btn = $(event.currentTarget);
    const input = btn.siblings('input[name="security.password"]');
    
    if (input.attr('type') === 'password') {
      input.attr('type', 'text');
      btn.find('i').removeClass('fa-eye').addClass('fa-eye-slash');
    } else {
      input.attr('type', 'password');
      btn.find('i').removeClass('fa-eye-slash').addClass('fa-eye');
    }
  }
  
  _onGeneratePassword(event) {
    event.preventDefault();
    const password = this._generateRandomPassword();
    this.element.find('input[name="security.password"]').val(password).attr('type', 'text');
    this.element.find('.toggle-password-btn i').removeClass('fa-eye').addClass('fa-eye-slash');
    
    ui.notifications.info(`Generated password: ${password}`);
  }
  
  _generateRandomPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const length = 12;
    let password = '';
    
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return password;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // ENABLED TOGGLE
  // ═══════════════════════════════════════════════════════════════════════════
  
  _onEnabledChange(event) {
    const enabled = event.target.checked;
    const label = this.element.find('.toggle-label');
    
    if (enabled) {
      label.html('<i class="fas fa-power-off"></i> Enabled');
    } else {
      label.html('<i class="fas fa-power-off"></i> Disabled');
    }
    
    this._updateLivePreview();
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // LIVE PREVIEW
  // ═══════════════════════════════════════════════════════════════════════════
  
  _updateLivePreview() {
    const formData = this._getFormData();
    
    // Update preview name
    this.element.find('.preview-name').text(formData.name || 'New Network');
    
    // Update preview ID
    this.element.find('.preview-id').text(formData.id || 'NETWORK_ID');
    
    // Update preview icon
    this.element.find('.preview-icon i').attr('class', `fas ${formData.theme.icon}`);
    
    // Update preview color
    this.element.find('.ncm-network-editor__preview').css('--preview-color', formData.theme.color);
    
    // Update status
    const statusHtml = formData.enabled
      ? '<span class="status-online"><i class="fas fa-check-circle"></i> Online</span>'
      : '<span class="status-offline"><i class="fas fa-times-circle"></i> Offline</span>';
    this.element.find('.preview-status').html(statusHtml);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PREVIEW DIALOG
  // ═══════════════════════════════════════════════════════════════════════════
  
  async _onPreview(event) {
    event.preventDefault();
    
    const formData = this._getFormData();
    
    // Render a preview card
    const previewHtml = await renderTemplate(
      `modules/${MODULE_ID}/templates/network-management/partials/network-card.hbs`,
      { network: formData, preview: true }
    );
    
    new Dialog({
      title: 'Network Preview',
      content: `
        <div class="ncm-preview-container" style="padding: 1rem; background: #1a1a1a;">
          ${previewHtml}
        </div>
      `,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close'
        }
      }
    }, {
      classes: ['ncm-dialog', 'ncm-preview-dialog'],
      width: 400
    }).render(true);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FORM DATA
  // ═══════════════════════════════════════════════════════════════════════════
  
  _getFormData() {
    const form = this.element.find('form')[0];
    const formData = new FormData(form);
    
    return {
      id: formData.get('id')?.trim().toUpperCase() || '',
      name: formData.get('name')?.trim() || '',
      type: formData.get('type') || 'custom',
      enabled: this.element.find('input[name="enabled"]').is(':checked'),
      description: formData.get('description')?.trim() || '',
      signalStrength: parseInt(formData.get('signalStrength')) || 90,
      reliability: parseInt(formData.get('reliability')) || 95,
      security: {
        level: formData.get('security.level') || 'none',
        requiresAuth: this.element.find('input[name="security.requiresAuth"]').is(':checked'),
        password: formData.get('security.password') || '',
        breachDC: parseInt(formData.get('security.breachDC')) || 0,
        attempts: parseInt(formData.get('security.attempts')) || 3,
        lockoutDuration: parseInt(formData.get('security.lockoutDuration')) || 0,
        iceDamage: formData.get('security.iceDamage') || ''
      },
      effects: {
        messageDelay: parseInt(formData.get('effects.messageDelay')) || 0,
        traced: this.element.find('input[name="effects.traced"]').is(':checked'),
        anonymity: this.element.find('input[name="effects.anonymity"]').is(':checked'),
        canRoute: this.element.find('input[name="effects.canRoute"]').is(':checked')
      },
      theme: {
        color: formData.get('theme.color') || '#19f3f7',
        icon: formData.get('theme.icon') || 'fa-wifi',
        glitchIntensity: parseFloat(formData.get('theme.glitchIntensity')) || 0.2
      },
      hidden: this.element.find('input[name="hidden"]').is(':checked'),
      gmNotes: formData.get('gmNotes')?.trim() || ''
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════
  
  _validateForm(data) {
    const errors = {};
    
    // Required: ID
    if (!data.id) {
      errors.id = 'Network ID is required';
    } else if (!/^[A-Z0-9_]+$/.test(data.id)) {
      errors.id = 'ID must contain only uppercase letters, numbers, and underscores';
    } else if (data.id.length > 32) {
      errors.id = 'ID must be 32 characters or less';
    }
    
    // Required: Name
    if (!data.name) {
      errors.name = 'Network name is required';
    } else if (data.name.length < 2) {
      errors.name = 'Name must be at least 2 characters';
    } else if (data.name.length > 50) {
      errors.name = 'Name must be 50 characters or less';
    }
    
    // Check for duplicate ID (create mode only)
    if (this.mode === 'create' && data.id) {
      const existingNetworks = game.settings.get(MODULE_ID, 'customNetworks') || [];
      if (existingNetworks.some(n => n.id === data.id)) {
        errors.id = 'A network with this ID already exists';
      }
    }
    
    // Signal strength range
    if (data.signalStrength < 0 || data.signalStrength > 100) {
      errors.signalStrength = 'Signal strength must be 0-100';
    }
    
    // Reliability range
    if (data.reliability < 0 || data.reliability > 100) {
      errors.reliability = 'Reliability must be 0-100';
    }
    
    // Breach DC range
    if (data.security.breachDC < 0 || data.security.breachDC > 50) {
      errors['security.breachDC'] = 'Breach DC must be 0-50';
    }
    
    return errors;
  }
  
  _showErrors(errors) {
    // Clear previous errors
    this.element.find('.field-error').text('');
    this.element.find('input, select, textarea').removeClass('input-error');
    
    // Show new errors
    for (const [field, message] of Object.entries(errors)) {
      const errorEl = this.element.find(`[data-error="${field}"]`);
      if (errorEl.length) {
        errorEl.text(message);
      }
      
      const inputEl = this.element.find(`[name="${field}"]`);
      if (inputEl.length) {
        inputEl.addClass('input-error');
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FORM SUBMISSION
  // ═══════════════════════════════════════════════════════════════════════════
  
  async _onSubmit(event) {
    event.preventDefault();
    
    const formData = this._getFormData();
    
    // Validate
    this.errors = this._validateForm(formData);
    
    if (Object.keys(this.errors).length > 0) {
      this._showErrors(this.errors);
      ui.notifications.error('Please fix the validation errors');
      return;
    }
    
    console.log(`${MODULE_ID} | Saving network:`, formData);
    
    // Call the save callback
    if (this.onSave) {
      try {
        await this.onSave(formData);
        this.close();
      } catch (error) {
        console.error(`${MODULE_ID} | Error saving network:`, error);
        ui.notifications.error(`Failed to save network: ${error.message}`);
      }
    } else {
      // Default save behavior
      try {
        if (this.mode === 'create' || this.mode === 'duplicate') {
          await game.nightcity.NetworkStorage.createNetwork(formData);
          ui.notifications.info(`Network "${formData.name}" created`);
        } else {
          await game.nightcity.NetworkStorage.updateNetwork(formData.id, formData);
          ui.notifications.info(`Network "${formData.name}" updated`);
        }
        this.close();
      } catch (error) {
        console.error(`${MODULE_ID} | Error saving network:`, error);
        ui.notifications.error(`Failed to save network: ${error.message}`);
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE
  // ═══════════════════════════════════════════════════════════════════════════
  
  async _onDelete(event) {
    event.preventDefault();
    
    const confirm = await Dialog.confirm({
      title: 'Delete Network',
      content: `
        <div style="padding: 1rem;">
          <p>Are you sure you want to delete <strong>${this.network.name}</strong>?</p>
          <p style="color: #F65261; margin-top: 0.5rem;">
            <i class="fas fa-exclamation-triangle"></i>
            This will also remove it from all scene configurations.
          </p>
        </div>
      `,
      yes: () => true,
      no: () => false
    });
    
    if (!confirm) return;
    
    if (this.onDelete) {
      try {
        await this.onDelete(this.network.id);
        this.close();
      } catch (error) {
        console.error(`${MODULE_ID} | Error deleting network:`, error);
        ui.notifications.error(`Failed to delete network: ${error.message}`);
      }
    } else {
      // Default delete behavior
      try {
        await game.nightcity.NetworkStorage.deleteNetwork(this.network.id);
        ui.notifications.info(`Network "${this.network.name}" deleted`);
        this.close();
      } catch (error) {
        console.error(`${MODULE_ID} | Error deleting network:`, error);
        ui.notifications.error(`Failed to delete network: ${error.message}`);
      }
    }
  }
}

/**
 * Quick factory for creating networks from templates
 */
NetworkEditorDialog.fromTemplate = function(templateName, options = {}) {
  const templates = {
    'public': {
      name: 'Public Network',
      type: 'public',
      enabled: true,
      signalStrength: 90,
      reliability: 85,
      security: { level: 'none', requiresAuth: false, breachDC: 0 },
      effects: { traced: false, anonymity: false },
      theme: { color: '#19f3f7', icon: 'fa-wifi', glitchIntensity: 0.1 }
    },
    'corporate': {
      name: 'Corporate Network',
      type: 'corporate',
      enabled: true,
      signalStrength: 100,
      reliability: 99,
      security: { level: 'high', requiresAuth: true, breachDC: 20, attempts: 3 },
      effects: { traced: true, anonymity: false },
      theme: { color: '#FFD700', icon: 'fa-building', glitchIntensity: 0.2 }
    },
    'darknet': {
      name: 'Darknet Node',
      type: 'darknet',
      enabled: true,
      signalStrength: 60,
      reliability: 70,
      security: { level: 'extreme', requiresAuth: true, breachDC: 25, attempts: 5 },
      effects: { traced: false, anonymity: true },
      theme: { color: '#9400D3', icon: 'fa-user-secret', glitchIntensity: 0.5 }
    },
    'military': {
      name: 'Military Network',
      type: 'military',
      enabled: true,
      signalStrength: 100,
      reliability: 99,
      security: { level: 'black-ice', requiresAuth: true, breachDC: 30, iceDamage: '5d6' },
      effects: { traced: true, anonymity: false },
      theme: { color: '#F65261', icon: 'fa-shield-alt', glitchIntensity: 0.3 }
    },
    'deadzone': {
      name: 'Dead Zone',
      type: 'custom',
      enabled: true,
      signalStrength: 0,
      reliability: 0,
      security: { level: 'none', requiresAuth: false, breachDC: 0 },
      effects: { traced: false, anonymity: false, canRoute: false },
      theme: { color: '#666666', icon: 'fa-ban', glitchIntensity: 1.0 }
    }
  };
  
  const template = templates[templateName];
  if (!template) {
    console.warn(`Unknown template: ${templateName}`);
    return new NetworkEditorDialog(options);
  }
  
  return new NetworkEditorDialog({
    ...options,
    mode: 'create',
    network: template
  });
};