/**
 * CreateNetworkDialog
 * @file scripts/ui/NetworkManagement/CreateNetworkDialog.js
 * @module cyberpunkred-messenger
 * @description Quick-create dialog for new custom networks. Provides 5 template
 *              presets (Fixer Den, Corp Office, Gang Turf, Secure Facility, Blank)
 *              with condensed 3-section form: Identity, Configuration, Appearance.
 *              Two save modes: "Create & Close" and "Create & Open in Manager".
 *
 *              Mockup reference: ncm-network-dialogs-mockup.html — Section 5.
 *
 *              Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, TEMPLATES, NETWORK_TYPES } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

// ─── Template Presets ────────────────────────────────────────

const PRESETS = Object.freeze({
  fixer_den: {
    label: 'Fixer Den',
    icon: 'fa-handshake',
    color: '#F65261',
    data: {
      name: '', type: 'hidden', description: 'Underground fixer network. Low profile.',
      signalStrength: 65, reliability: 70, messageDelay: 500,
      security: { requiresAuth: true, authType: 'password', password: '', level: 'standard' },
      traced: false, anonymous: true, globallyAvailable: false,
      theme: { icon: 'fa-handshake', color: '#F65261' },
    },
  },
  corp_office: {
    label: 'Corp Office',
    icon: 'fa-building',
    color: '#f7c948',
    data: {
      name: '', type: 'corporate', description: 'Corporate internal network. Heavy ICE.',
      signalStrength: 90, reliability: 95, messageDelay: 200,
      security: { requiresAuth: true, authType: 'password', password: '', level: 'advanced' },
      traced: true, anonymous: false, globallyAvailable: false,
      theme: { icon: 'fa-building', color: '#f7c948' },
    },
  },
  gang_turf: {
    label: 'Gang Turf',
    icon: 'fa-skull',
    color: '#ff0033',
    data: {
      name: '', type: 'hidden', description: 'Gang-controlled local mesh. Unstable.',
      signalStrength: 45, reliability: 50, messageDelay: 800,
      security: { requiresAuth: false, authType: 'none', password: '', level: 'none' },
      traced: false, anonymous: true, globallyAvailable: false,
      theme: { icon: 'fa-skull', color: '#ff0033' },
    },
  },
  secure_facility: {
    label: 'Secure Facility',
    icon: 'fa-shield-halved',
    color: '#19f3f7',
    data: {
      name: '', type: 'government', description: 'Hardened facility network. Maximum security.',
      signalStrength: 95, reliability: 99, messageDelay: 100,
      security: { requiresAuth: true, authType: 'skill', password: '', bypassDC: 18, level: 'maximum' },
      traced: true, anonymous: false, globallyAvailable: false,
      theme: { icon: 'fa-shield-halved', color: '#19f3f7' },
    },
  },
  blank: {
    label: 'Blank',
    icon: 'fa-circle-dot',
    color: '#8888a0',
    data: {
      name: '', type: 'public', description: '',
      signalStrength: 75, reliability: 75, messageDelay: 300,
      security: { requiresAuth: false, authType: 'none', password: '', level: 'none' },
      traced: false, anonymous: false, globallyAvailable: false,
      theme: { icon: 'fa-wifi', color: '#19f3f7' },
    },
  },
});

// ─── Icon Options ────────────────────────────────────────────

const ICON_OPTIONS = [
  { value: 'fa-wifi',            label: 'WiFi' },
  { value: 'fa-mask',            label: 'Mask' },
  { value: 'fa-building',        label: 'Building' },
  { value: 'fa-tower-broadcast', label: 'Broadcast' },
  { value: 'fa-crosshairs',      label: 'Crosshairs' },
  { value: 'fa-server',          label: 'Server' },
  { value: 'fa-satellite-dish',  label: 'Satellite' },
  { value: 'fa-landmark',        label: 'Landmark' },
  { value: 'fa-skull',           label: 'Skull' },
  { value: 'fa-handshake',       label: 'Handshake' },
  { value: 'fa-shield-halved',   label: 'Shield' },
  { value: 'fa-circle-dot',      label: 'Circle' },
];

export class CreateNetworkDialog extends BaseApplication {

  /** @type {string} Currently selected preset key */
  _selectedPreset = 'blank';

  /** @type {object} Working copy of form data — seeded by preset, updated by user */
  _formData = null;

  /** @type {Function|null} Resolve callback for promise-based show() */
  _resolve = null;

  // ─── Service Accessors ───

  get networkService() { return game.nightcity?.networkService; }

  // ─── ApplicationV2 Configuration ───

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-create-network',
    classes: ['ncm-app', 'ncm-create-network-dialog'],
    window: {
      title: 'NCM.Network.CreateNetwork',
      icon: 'fas fa-plus',
      resizable: false,
      minimizable: false,
    },
    position: {
      width: 480,
      height: 'auto',
    },
    actions: {
      selectPreset:     CreateNetworkDialog._onSelectPreset,
      createAndClose:   CreateNetworkDialog._onCreateAndClose,
      createAndOpen:    CreateNetworkDialog._onCreateAndOpen,
      cancel:           CreateNetworkDialog._onCancel,
    },
  }, { inplace: false });

  static PARTS = {
    main: {
      template: TEMPLATES.CREATE_NETWORK_DIALOG,
    },
  };

  // ─── Static Factory ───

  /**
   * Show the create network dialog and return a promise that resolves
   * with the created network object (or null if cancelled).
   * @param {object} [options]
   * @param {string} [options.preset='blank'] - Initial preset to select
   * @returns {Promise<object|null>} Created network object or null
   */
  static async show(options = {}) {
    if (!isGM()) {
      ui.notifications.warn('NCM | Only the GM can create networks.');
      return null;
    }

    return new Promise((resolve) => {
      const dialog = new CreateNetworkDialog();
      dialog._selectedPreset = options.preset || 'blank';
      dialog._formData = CreateNetworkDialog._clonePresetData(dialog._selectedPreset);
      dialog._resolve = resolve;
      dialog.render(true);
    });
  }

  // ─── Data Preparation ───

  async _prepareContext(options) {
    const data = this._formData ?? CreateNetworkDialog._clonePresetData('blank');

    // Build preset list with active state
    const presets = Object.entries(PRESETS).map(([key, preset]) => ({
      key,
      label: preset.label,
      icon: preset.icon,
      color: preset.color,
      isActive: key === this._selectedPreset,
    }));

    // Build icon options with selection state
    const iconOptions = ICON_OPTIONS.map(opt => ({
      ...opt,
      selected: opt.value === data.theme.icon,
    }));

    // Network type options
    const typeOptions = [
      { value: 'public',     label: 'Public',     selected: data.type === 'public' },
      { value: 'hidden',     label: 'Hidden',     selected: data.type === 'hidden' },
      { value: 'corporate',  label: 'Corporate',  selected: data.type === 'corporate' },
      { value: 'government', label: 'Government', selected: data.type === 'government' },
      { value: 'custom',     label: 'Custom',     selected: data.type === 'custom' },
    ];

    // Auth type options
    const authTypeOptions = [
      { value: 'none',     label: 'None (Open)',  selected: data.security.authType === 'none' },
      { value: 'password', label: 'Password',     selected: data.security.authType === 'password' },
      { value: 'skill',    label: 'Skill Check',  selected: data.security.authType === 'skill' },
    ];

    const showPassword = data.security.authType === 'password';
    const showBypassDC = data.security.authType === 'skill';
    const showICE = data.security.authType === 'skill';

    // ICE type options
    const encType = data.security.encryptionType || 'ICE';
    const iceTypeOptions = [
      { value: 'ICE',       label: 'Standard ICE',  selected: encType === 'ICE' },
      { value: 'BLACK_ICE', label: 'BLACK ICE',      selected: encType === 'BLACK_ICE' },
      { value: 'RED_ICE',   label: 'RED ICE',        selected: encType === 'RED_ICE' },
    ];

    // Failure mode options
    const fMode = data.security.failureMode || 'lockout';
    const failureModeOptions = [
      { value: 'nothing',   label: 'Nothing',          selected: fMode === 'nothing' },
      { value: 'lockout',   label: 'Lockout',           selected: fMode === 'lockout' },
      { value: 'permanent', label: 'Permanent Lockout', selected: fMode === 'permanent' },
      { value: 'damage',    label: 'Damage (ICE)',       selected: fMode === 'damage' },
    ];

    // ICE source
    const iceConfig = data.security.ice ?? {};
    const iceSource = iceConfig.source ?? 'default';
    const isLethalICE = encType === 'BLACK_ICE' || encType === 'RED_ICE';

    // Black ICE actors for actor picker
    const blackIceActors = (game.actors?.filter(a =>
      a.type === 'blackIce' || a.type === 'black-ice' ||
      a.getFlag?.(MODULE_ID, 'isBlackICE') ||
      a.name?.toLowerCase().includes('black ice')
    ) ?? []).map(a => ({
      id: a.id, name: a.name, img: a.img,
      atk: a.system?.stats?.atk ?? 0,
      selected: iceConfig.actorId === a.id,
    }));

    return {
      presets,
      iconOptions,
      typeOptions,
      authTypeOptions,
      showPassword,
      showBypassDC,
      showICE,
      iceTypeOptions,
      failureModeOptions,
      isLethalICE,
      iceSource,
      iceSourceDefault: iceSource === 'default',
      iceSourceCustom: iceSource === 'custom',
      iceSourceActor: iceSource === 'actor',
      iceConfig,
      blackIceActors,
      data,
      isGM: isGM(),
      MODULE_ID,
    };
  }

  // ─── Post-Render Wiring ───

  _onRender(context, options) {
    super._onRender(context, options);

    const html = this.element;
    if (!html) return;

    // ─── Live bindings: Auth type toggling ───
    const authSelect = html.querySelector('[name="authType"]');
    if (authSelect) {
      authSelect.addEventListener('change', (e) => {
        this._syncFormToData();
        this.render();
      });
    }

    // ─── Live bindings: ICE type / failure mode → re-render for conditional sections ───
    const iceTypeSelect = html.querySelector('[name="encryptionType"]');
    if (iceTypeSelect) {
      iceTypeSelect.addEventListener('change', () => {
        this._syncFormToData();
        this.render();
      });
    }
    const failureModeSelect = html.querySelector('[name="failureMode"]');
    if (failureModeSelect) {
      failureModeSelect.addEventListener('change', () => {
        this._syncFormToData();
        this.render();
      });
    }

    // ─── Live bindings: ICE source cards ───
    html.querySelectorAll('[data-ice-mode]')?.forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.dataset.iceMode;
        const hidden = html.querySelector('[name="iceSource"]');
        if (hidden) hidden.value = mode;
        this._syncFormToData();
        this.render();
      });
    });

    // ─── Live bindings: ICE actor cards ───
    html.querySelectorAll('[data-ice-actor]')?.forEach(card => {
      card.addEventListener('click', () => {
        const actorId = card.dataset.iceActor;
        const hidden = html.querySelector('[name="iceActorId"]');
        if (hidden) hidden.value = actorId;
        // Highlight selected
        html.querySelectorAll('[data-ice-actor]').forEach(c => c.classList.remove('ncm-create-net__ice-actor--sel'));
        card.classList.add('ncm-create-net__ice-actor--sel');
      });
    });

    // ─── Live bindings: Icon preview + color swatch updates ───
    const iconSelect = html.querySelector('[name="themeIcon"]');
    const iconPreview = html.querySelector('.ncm-create-net__icon-preview i');
    if (iconSelect && iconPreview) {
      iconSelect.addEventListener('change', () => {
        iconPreview.className = `fas ${iconSelect.value}`;
      });
    }

    const colorInput = html.querySelector('[name="themeColor"]');
    const colorSwatch = html.querySelector('.ncm-create-net__swatch');
    const iconPreviewBox = html.querySelector('.ncm-create-net__icon-preview');
    if (colorInput && colorSwatch) {
      colorInput.addEventListener('input', () => {
        const hex = colorInput.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
          colorSwatch.style.background = hex;
          if (iconPreviewBox) {
            iconPreviewBox.style.color = hex;
            iconPreviewBox.style.borderColor = `${hex}26`;
            iconPreviewBox.style.background = `${hex}14`;
          }
        }
      });
    }

    // ─── Enter key submits the form ───
    html.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        this._doCreate(false);
      }
    });
  }

  // ─── Form Sync Helper ───

  /**
   * Read current DOM form values back into this._formData.
   * Called before save or preset switch (to preserve user edits to name).
   */
  _syncFormToData() {
    const html = this.element;
    if (!html) return;

    const val = (name) => html.querySelector(`[name="${name}"]`)?.value ?? '';
    const checked = (name) => html.querySelector(`[name="${name}"]`)?.checked ?? false;
    const num = (name, fallback) => parseInt(val(name)) || fallback;

    this._formData = {
      name: val('name'),
      type: val('type'),
      description: val('description'),
      signalStrength: num('signalStrength', 75),
      reliability: num('reliability', 75),
      messageDelay: num('messageDelay', 300),
      security: {
        requiresAuth: val('authType') !== 'none',
        authType: val('authType'),
        password: val('password'),
        bypassDC: num('bypassDC', 15),
        level: this._deriveSecurityLevel(val('authType')),
        encryptionType: val('encryptionType') || 'ICE',
        failureMode: val('failureMode') || 'lockout',
        ice: {
          source: val('iceSource') || 'default',
          actorId: val('iceActorId') || null,
          customName: val('iceCustomName') || '',
          customPortrait: val('iceCustomPortrait') || '',
          customDamage: val('iceCustomDamage') || '',
        },
      },
      traced: checked('traced'),
      anonymous: checked('anonymous'),
      globallyAvailable: checked('globallyAvailable'),
      theme: {
        icon: val('themeIcon'),
        color: val('themeColor'),
      },
    };
  }

  /**
   * Derive security level string from auth type.
   * @param {string} authType
   * @returns {string}
   */
  _deriveSecurityLevel(authType) {
    switch (authType) {
      case 'password': return 'standard';
      case 'skill':    return 'advanced';
      default:         return 'none';
    }
  }

  // ─── Action Handlers ───

  /**
   * User clicked a preset pill. Apply the preset data but preserve current name.
   */
  static _onSelectPreset(event, target) {
    const key = target.closest('[data-preset]')?.dataset.preset;
    if (!key || !PRESETS[key]) return;

    // Save current name before switching
    const currentName = this.element?.querySelector('[name="name"]')?.value ?? '';

    this._selectedPreset = key;
    this._formData = CreateNetworkDialog._clonePresetData(key);

    // Restore name if user had typed one
    if (currentName.trim()) {
      this._formData.name = currentName;
    }

    this.render();
  }

  /**
   * Create & Close button.
   */
  static async _onCreateAndClose() {
    await this._doCreate(false);
  }

  /**
   * Create & Open in Manager button.
   */
  static async _onCreateAndOpen() {
    await this._doCreate(true);
  }

  /**
   * Cancel — close without creating.
   */
  static _onCancel() {
    this._resolve?.(null);
    this._resolve = null;
    this.close();
  }

  // ─── Core Creation Logic ───

  /**
   * Validate form, build network data, call NetworkService.createNetwork().
   * @param {boolean} openInManager - Whether to open the Network Manager after creation
   */
  async _doCreate(openInManager = false) {
    this._syncFormToData();
    const data = this._formData;

    // ─── Validation ───
    if (!data.name?.trim()) {
      ui.notifications.warn('NCM | Network name is required.');
      const nameInput = this.element?.querySelector('[name="name"]');
      nameInput?.focus();
      nameInput?.classList.add('ncm-create-net__input--error');
      setTimeout(() => nameInput?.classList.remove('ncm-create-net__input--error'), 1500);
      return;
    }

    if (data.security.authType === 'password' && data.security.requiresAuth && !data.security.password?.trim()) {
      ui.notifications.warn('NCM | Password is required for password-protected networks.');
      this.element?.querySelector('[name="password"]')?.focus();
      return;
    }

    // ─── Build network object for NetworkService ───
    const networkData = {
      name: data.name.trim(),
      type: data.type || NETWORK_TYPES.CUSTOM,
      availability: {
        global: data.globallyAvailable,
        scenes: [],
      },
      signalStrength: data.signalStrength,
      reliability: data.reliability,
      security: {
        level: data.security.level,
        requiresAuth: data.security.requiresAuth,
        password: data.security.password?.trim() || '',
        bypassSkills: data.security.authType === 'skill' ? ['interface'] : [],
        bypassDC: data.security.bypassDC || 15,
        maxAttempts: 3,
        lockoutDuration: 3600000,
        encryptionType: data.security.encryptionType || 'ICE',
        failureMode: data.security.failureMode || 'lockout',
        ice: data.security.ice ?? { source: 'default', actorId: null, customName: '', customPortrait: '', customDamage: '' },
      },
      effects: {
        messageDelay: data.messageDelay,
        traced: data.traced,
        anonymity: data.anonymous,
        canRoute: true,
        restrictedAccess: false,
        allowedRecipientNetworks: [],
      },
      theme: {
        color: data.theme.color || '#19f3f7',
        icon: data.theme.icon || 'fa-wifi',
        glitchIntensity: 0.1,
      },
      description: data.description?.trim() || '',
      lore: '',
    };

    // ─── Call the service ───
    const result = await this.networkService?.createNetwork(networkData);

    if (!result?.success) {
      ui.notifications.error(`NCM | Failed to create network: ${result?.error || 'Unknown error'}`);
      return;
    }

    ui.notifications.info(`NCM | Network "${networkData.name}" created.`);
    log.info(`Created network: ${result.network.id} — "${networkData.name}"`);

    // Resolve the promise with the new network
    this._resolve?.(result.network);
    this._resolve = null;

    // Close this dialog
    this.close();

    // Optionally open the full Network Manager to the new network
    if (openInManager) {
      this._openManagerToNetwork(result.network.id);
    }
  }

  /**
   * Open the Network Manager and select the newly created network.
   * @param {string} networkId
   */
  _openManagerToNetwork(networkId) {
    try {
      // Import dynamically to avoid circular deps
      const managerApp = Object.values(ui.windows).find(
        w => w.id === 'ncm-network-management'
      );

      if (managerApp) {
        // Manager already open — select the new network and bring to front
        managerApp._selectedNetworkId = networkId;
        managerApp._activeTab = 'networks';
        managerApp._isEditMode = false;
        managerApp._isCreating = false;
        managerApp.bringToFront();
        managerApp.render();
      } else {
        // Open fresh manager — pass the network to select
        game.nightcity?.openNetworkManager?.();
        // After a tick, select the network
        setTimeout(() => {
          const mgr = Object.values(ui.windows).find(
            w => w.id === 'ncm-network-management'
          );
          if (mgr) {
            mgr._selectedNetworkId = networkId;
            mgr._activeTab = 'networks';
            mgr.render();
          }
        }, 200);
      }
    } catch (err) {
      log.warn('Could not open Network Manager to new network:', err);
    }
  }

  // ─── Cleanup ───

  /**
   * Override close to resolve promise if still pending.
   */
  async close(options = {}) {
    if (this._resolve) {
      this._resolve(null);
      this._resolve = null;
    }
    return super.close(options);
  }

  // ─── Utility ───

  /**
   * Deep clone a preset's data object.
   * @param {string} presetKey
   * @returns {object}
   */
  static _clonePresetData(presetKey) {
    const preset = PRESETS[presetKey] ?? PRESETS.blank;
    return foundry.utils.deepClone(preset.data);
  }
}
