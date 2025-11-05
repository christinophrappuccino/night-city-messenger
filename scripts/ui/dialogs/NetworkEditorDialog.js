/**
 * Network Editor Dialog - Simplified Property Editor
 * File: scripts/ui/dialogs/NetworkEditorDialog.js
 * Module: cyberpunkred-messenger
 * 
 * SIMPLIFIED: Only edits network PROPERTIES
 * - Name, type, security, theme, colors
 * - defaultHidden status (visibility hint)
 * - Optional: Enable in current scene on creation
 * 
 * Scene availability is configured in Scene Tab only
 */

import { MODULE_ID, NETWORK_TYPES, SECURITY_LEVELS } from '../../constants.js';

export default class NetworkEditorDialog extends FormApplication {
  constructor(options = {}) {
    super({}, options);
    
    this.mode = options.mode || 'create'; // 'create' or 'edit'
    this.network = options.network || this._getDefaultNetwork();
    this.onSave = options.onSave || (() => {});
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'network-editor-dialog',
      classes: ['cyberpunkred-messenger', 'network-editor'],
      template: 'modules/cyberpunkred-messenger/templates/dialogs/network-editor.hbs',
      width: 600,
      height: 'auto',
      closeOnSubmit: false,
      submitOnChange: false
    });
  }

  get title() {
    return this.mode === 'create' ? 'Create Network' : `Edit Network: ${this.network.name}`;
  }

  _getDefaultNetwork() {
    return {
      id: foundry.utils.randomID(),
      name: 'New Network',
      type: 'public',
      description: '',
      defaultHidden: false,
      enableInCurrentScene: true, // Only used on creation
      security: {
        level: 'basic',
        encryptionStrength: 6,
        hackDC: 15
      },
      theme: {
        primaryColor: '#F65261',
        secondaryColor: '#19f3f7',
        backgroundColor: '#1a1a1a',
        fontFamily: 'Rajdhani'
      },
      features: {
        encryption: true,
        fileTransfer: true,
        voiceCall: false,
        videoCall: false
      },
      metadata: {
        created: new Date().toISOString(),
        createdBy: game.user.id
      }
    };
  }

  async getData() {
    const data = await super.getData();
    
    return {
      ...data,
      network: this.network,
      mode: this.mode,
      isCreate: this.mode === 'create',
      isEdit: this.mode === 'edit',
      hasCurrentScene: !!game.scenes.current,
      currentSceneName: game.scenes.current?.name,
      networkTypes: Object.entries(NETWORK_TYPES).map(([key, value]) => ({
        value: key,
        label: value.label,
        selected: this.network.type === key
      })),
      securityLevels: Object.entries(SECURITY_LEVELS).map(([key, value]) => ({
        value: key,
        label: value.label,
        selected: this.network.security.level === key
      }))
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Color pickers
    html.find('input[type="color"]').change(this._onColorChange.bind(this));
    
    // Security level presets
    html.find('select[name="security.level"]').change(this._onSecurityLevelChange.bind(this));
    
    // Network type change
    html.find('select[name="type"]').change(this._onNetworkTypeChange.bind(this));
    
    // Preview theme
    html.find('[data-action="preview-theme"]').click(this._onPreviewTheme.bind(this));
    
    // Reset theme
    html.find('[data-action="reset-theme"]').click(this._onResetTheme.bind(this));
  }

  async _onColorChange(event) {
    const input = event.currentTarget;
    const previewElement = input.parentElement.querySelector('.color-preview');
    if (previewElement) {
      previewElement.style.backgroundColor = input.value;
    }
  }

  async _onSecurityLevelChange(event) {
    const level = event.target.value;
    const preset = SECURITY_LEVELS[level];
    
    if (preset) {
      // Update security fields with preset values
      const form = event.target.closest('form');
      form.querySelector('[name="security.encryptionStrength"]').value = preset.encryptionStrength;
      form.querySelector('[name="security.hackDC"]').value = preset.hackDC;
    }
  }

  async _onNetworkTypeChange(event) {
    const type = event.target.value;
    const typeInfo = NETWORK_TYPES[type];
    
    if (typeInfo) {
      // Update description with type info
      const descField = event.target.closest('form').querySelector('[name="description"]');
      if (descField && !descField.value) {
        descField.value = typeInfo.description;
      }
      
      // Suggest defaultHidden based on type
      const hiddenCheckbox = event.target.closest('form').querySelector('[name="defaultHidden"]');
      if (hiddenCheckbox) {
        if (type === 'darknet' || type === 'corporate' || type === 'military') {
          hiddenCheckbox.checked = true;
        }
      }
    }
  }

  async _onPreviewTheme(event) {
    event.preventDefault();
    
    const form = this.element.find('form')[0];
    const formData = new FormDataExtended(form).object;
    
    // Apply theme temporarily to dialog
    const dialog = this.element[0];
    dialog.style.setProperty('--ncm-primary', formData.theme.primaryColor);
    dialog.style.setProperty('--ncm-secondary', formData.theme.secondaryColor);
    dialog.style.setProperty('--ncm-background', formData.theme.backgroundColor);
    dialog.style.setProperty('font-family', formData.theme.fontFamily);
    
    ui.notifications.info("Theme preview applied to this dialog");
  }

  async _onResetTheme(event) {
    event.preventDefault();
    
    const form = this.element.find('form')[0];
    const defaults = this._getDefaultNetwork().theme;
    
    form.querySelector('[name="theme.primaryColor"]').value = defaults.primaryColor;
    form.querySelector('[name="theme.secondaryColor"]').value = defaults.secondaryColor;
    form.querySelector('[name="theme.backgroundColor"]').value = defaults.backgroundColor;
    form.querySelector('[name="theme.fontFamily"]').value = defaults.fontFamily;
    
    // Update color previews
    form.querySelectorAll('input[type="color"]').forEach(input => {
      const preview = input.parentElement.querySelector('.color-preview');
      if (preview) preview.style.backgroundColor = input.value;
    });
    
    ui.notifications.info("Theme reset to defaults");
  }

  async _updateObject(event, formData) {
    // Validate network name
    if (!formData.name || formData.name.trim() === '') {
      ui.notifications.error("Network name is required");
      return;
    }

    // Merge form data with existing network
    const updatedNetwork = foundry.utils.mergeObject(this.network, formData);
    
    // Validate security values
    updatedNetwork.security.encryptionStrength = Math.max(1, Math.min(10, updatedNetwork.security.encryptionStrength));
    updatedNetwork.security.hackDC = Math.max(6, Math.min(30, updatedNetwork.security.hackDC));
    
    // Update metadata
    if (this.mode === 'create') {
      updatedNetwork.metadata.created = new Date().toISOString();
      updatedNetwork.metadata.createdBy = game.user.id;
    } else {
      updatedNetwork.metadata.modified = new Date().toISOString();
      updatedNetwork.metadata.modifiedBy = game.user.id;
    }

    // Call save callback
    await this.onSave(updatedNetwork);
    
    // Close dialog
    this.close();
  }
}

/* -------------------------------------------- */
/*  Constants                                   */
/* -------------------------------------------- */

const NETWORK_TYPES = {
  public: {
    label: 'Public Network',
    description: 'Open civilian network accessible to all. Low security, high visibility.',
    icon: 'fa-globe',
    suggestedSecurity: 'basic'
  },
  corporate: {
    label: 'Corporate Network',
    description: 'Private corporate subnet. Requires credentials or hacking.',
    icon: 'fa-building',
    suggestedSecurity: 'medium'
  },
  darknet: {
    label: 'Darknet',
    description: 'Anonymous underground network. Untraceable but monitored.',
    icon: 'fa-user-secret',
    suggestedSecurity: 'medium'
  },
  military: {
    label: 'Military Network',
    description: 'Secure military subnet. Heavy ICE protection.',
    icon: 'fa-shield-alt',
    suggestedSecurity: 'high'
  },
  local: {
    label: 'Local Network',
    description: 'Short-range local network. Limited range but secure.',
    icon: 'fa-wifi',
    suggestedSecurity: 'basic'
  },
  custom: {
    label: 'Custom Network',
    description: 'User-defined network with custom properties.',
    icon: 'fa-cog',
    suggestedSecurity: 'basic'
  }
};

const SECURITY_LEVELS = {
  none: {
    label: 'None',
    encryptionStrength: 0,
    hackDC: 6,
    description: 'No security. Open access.'
  },
  basic: {
    label: 'Basic',
    encryptionStrength: 3,
    hackDC: 10,
    description: 'Basic encryption. Easy to bypass.'
  },
  medium: {
    label: 'Medium',
    encryptionStrength: 6,
    hackDC: 15,
    description: 'Standard corporate security.'
  },
  high: {
    label: 'High',
    encryptionStrength: 8,
    hackDC: 20,
    description: 'Military-grade protection.'
  },
  maximum: {
    label: 'Maximum',
    encryptionStrength: 10,
    hackDC: 25,
    description: 'BLACK ICE and lethal countermeasures.'
  }
};