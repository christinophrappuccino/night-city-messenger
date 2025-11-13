/**
 * Network Management Application - Streamlined
 * File: scripts/ui/components/NetworkManagement/NetworkManagementApp.js
 * Module: cyberpunkred-messenger
 * Description: Simplified GM network management interface
 * 
 * SIMPLIFIED:
 * - Two panels instead of 5 tabs
 * - Left: Network list and CRUD
 * - Right: Scene configuration
 * - Removed Events, Logs, Settings tabs
 */

import { MODULE_ID } from '../../../utils/constants.js';

export class NetworkManagementApp extends Application {
  constructor(options = {}) {
    super(options);
    
    this.networkManager = game.nightcity?.networkManager;
    this.selectedNetwork = null;
    this.selectedScene = game.scenes.current?.id;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'ncm-network-management',
      classes: ['ncm-network-management'],
      template: `modules/${MODULE_ID}/templates/network-management/network-management.hbs`,
      width: 900,
      height: 600,
      resizable: true,
      title: 'Network Management'
    });
  }

  async getData() {
    const data = await super.getData();
    
    const networks = await this.networkManager.getAllNetworks();
    const currentScene = game.scenes.get(this.selectedScene);
    const sceneConfig = currentScene?.getFlag(MODULE_ID, 'networks') || {};
    
    // Prepare network data
    const networkData = networks.map(network => ({
      ...network,
      isDefault: ['CITINET', 'CORPNET', 'DARKNET'].includes(network.id),
      selected: this.selectedNetwork === network.id,
      sceneConfig: sceneConfig[network.id] || {
        available: true,
        signal: 100
      }
    }));
    
    // Get all scenes
    const scenes = game.scenes.map(s => ({
      id: s.id,
      name: s.name,
      active: s.active,
      selected: s.id === this.selectedScene
    }));
    
    return {
      ...data,
      networks: networkData,
      scenes: scenes,
      currentScene: currentScene,
      selectedNetwork: networkData.find(n => n.selected),
      isGM: game.user.isGM
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    
    // Network panel events
    html.find('.network-card').click(this._onNetworkSelect.bind(this));
    html.find('.create-network-btn').click(this._onCreateNetwork.bind(this));
    html.find('.edit-network-btn').click(this._onEditNetwork.bind(this));
    html.find('.duplicate-network-btn').click(this._onDuplicateNetwork.bind(this));
    html.find('.delete-network-btn').click(this._onDeleteNetwork.bind(this));
    
    // Scene panel events
    html.find('.scene-selector').change(this._onSceneChange.bind(this));
    html.find('.network-available').change(this._onAvailabilityToggle.bind(this));
    html.find('.signal-slider').on('input', this._onSignalChange.bind(this));
    
    // Quick actions
    html.find('.enable-all-btn').click(this._onEnableAll.bind(this));
    html.find('.disable-all-btn').click(this._onDisableAll.bind(this));
    html.find('.copy-from-scene-btn').click(this._onCopyFromScene.bind(this));
    
    // Prevent event bubbling on controls
    html.find('.network-controls').click(e => e.stopPropagation());
  }

  /* -------------------------------------------- */
  /*  Network Panel Events                        */
  /* -------------------------------------------- */

  async _onNetworkSelect(event) {
    const networkId = event.currentTarget.dataset.networkId;
    this.selectedNetwork = this.selectedNetwork === networkId ? null : networkId;
    this.render(false);
  }

  async _onCreateNetwork(event) {
    event.preventDefault();
    
    const dialog = new NetworkEditDialog({
      title: 'Create Network',
      network: null,
      callback: async (networkData) => {
        await this.networkManager.createNetwork(networkData);
        ui.notifications.info(`Network "${networkData.name}" created`);
        this.render(false);
      }
    });
    
    dialog.render(true);
  }

  async _onEditNetwork(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.closest('.network-card').dataset.networkId;
    const networks = await this.networkManager.getAllNetworks();
    const network = networks.find(n => n.id === networkId);
    
    const dialog = new NetworkEditDialog({
      title: `Edit ${network.name}`,
      network: network,
      callback: async (networkData) => {
        await this.networkManager.updateNetwork(networkId, networkData);
        ui.notifications.info(`Network "${networkData.name}" updated`);
        this.render(false);
      }
    });
    
    dialog.render(true);
  }

  async _onDuplicateNetwork(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.closest('.network-card').dataset.networkId;
    const networks = await this.networkManager.getAllNetworks();
    const network = networks.find(n => n.id === networkId);
    
    const newNetwork = duplicate(network);
    newNetwork.id = `${network.id}_copy_${Date.now()}`;
    newNetwork.name = `${network.name} (Copy)`;
    newNetwork.type = 'CUSTOM';
    
    await this.networkManager.createNetwork(newNetwork);
    ui.notifications.info(`Network duplicated as "${newNetwork.name}"`);
    this.render(false);
  }

  async _onDeleteNetwork(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const networkId = event.currentTarget.closest('.network-card').dataset.networkId;
    const networks = await this.networkManager.getAllNetworks();
    const network = networks.find(n => n.id === networkId);
    
    const confirm = await Dialog.confirm({
      title: 'Delete Network',
      content: `<p>Delete "${network.name}"?</p>
                <p class="warning">This cannot be undone.</p>`
    });
    
    if (confirm) {
      await this.networkManager.deleteNetwork(networkId);
      ui.notifications.info(`Network "${network.name}" deleted`);
      
      if (this.selectedNetwork === networkId) {
        this.selectedNetwork = null;
      }
      
      this.render(false);
    }
  }

  /* -------------------------------------------- */
  /*  Scene Panel Events                          */
  /* -------------------------------------------- */

  async _onSceneChange(event) {
    this.selectedScene = event.currentTarget.value;
    this.render(false);
  }

  async _onAvailabilityToggle(event) {
    const networkId = event.currentTarget.dataset.networkId;
    const available = event.currentTarget.checked;
    
    await this.networkManager.setSceneNetwork(
      this.selectedScene,
      networkId,
      { 
        available,
        signal: $(event.currentTarget).closest('.scene-network-config')
          .find('.signal-slider').val() || 100
      }
    );
  }

  async _onSignalChange(event) {
    const networkId = event.currentTarget.dataset.networkId;
    const signal = parseInt(event.currentTarget.value);
    
    // Update display
    $(event.currentTarget).siblings('.signal-value').text(`${signal}%`);
    
    // Debounced save
    if (this._signalTimeout) clearTimeout(this._signalTimeout);
    
    this._signalTimeout = setTimeout(async () => {
      const available = $(event.currentTarget).closest('.scene-network-config')
        .find('.network-available').prop('checked');
        
      await this.networkManager.setSceneNetwork(
        this.selectedScene,
        networkId,
        { available, signal }
      );
    }, 500);
  }

  /* -------------------------------------------- */
  /*  Quick Actions                               */
  /* -------------------------------------------- */

  async _onEnableAll(event) {
    event.preventDefault();
    
    const networks = await this.networkManager.getAllNetworks();
    
    for (const network of networks) {
      await this.networkManager.setSceneNetwork(
        this.selectedScene,
        network.id,
        { available: true, signal: 100 }
      );
    }
    
    ui.notifications.info('Enabled all networks');
    this.render(false);
  }

  async _onDisableAll(event) {
    event.preventDefault();
    
    const networks = await this.networkManager.getAllNetworks();
    
    for (const network of networks) {
      await this.networkManager.setSceneNetwork(
        this.selectedScene,
        network.id,
        { available: false, signal: 0 }
      );
    }
    
    ui.notifications.info('Disabled all networks');
    this.render(false);
  }

  async _onCopyFromScene(event) {
    event.preventDefault();
    
    const scenes = game.scenes.filter(s => s.id !== this.selectedScene);
    
    if (!scenes.length) {
      ui.notifications.warn('No other scenes to copy from');
      return;
    }
    
    const choices = {};
    scenes.forEach(s => choices[s.id] = s.name);
    
    const sceneId = await Dialog.prompt({
      title: 'Copy Network Configuration',
      content: `
        <select id="source-scene">
          ${scenes.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
      `,
      callback: html => html.find('#source-scene').val()
    });
    
    if (!sceneId) return;
    
    const sourceScene = game.scenes.get(sceneId);
    const sourceConfig = sourceScene.getFlag(MODULE_ID, 'networks') || {};
    
    const targetScene = game.scenes.get(this.selectedScene);
    await targetScene.setFlag(MODULE_ID, 'networks', sourceConfig);
    
    ui.notifications.info(`Copied configuration from ${sourceScene.name}`);
    this.render(false);
  }
}

/* -------------------------------------------- */
/*  Network Edit Dialog                         */
/* -------------------------------------------- */

class NetworkEditDialog extends Dialog {
  constructor(options) {
    const network = options.network || {
      name: '',
      icon: 'fa-wifi',
      color: '#19f3f7',
      description: '',
      requiresAuth: false,
      authType: 'password',
      password: '',
      hackingDC: 15,
      hackingSkill: 'interface',
      canSendMessages: true,
      canAccessShards: true
    };
    
    super({
      title: options.title,
      content: `
        <form class="ncm-network-edit">
          <div class="form-group">
            <label>Network Name *</label>
            <input type="text" name="name" value="${network.name}" required>
          </div>
          
          <div class="form-group">
            <label>Description</label>
            <textarea name="description">${network.description}</textarea>
          </div>
          
          <div class="form-group split">
            <div>
              <label>Icon (FontAwesome class)</label>
              <input type="text" name="icon" value="${network.icon}" placeholder="fa-wifi">
            </div>
            <div>
              <label>Color</label>
              <input type="color" name="color" value="${network.color}">
            </div>
          </div>
          
          <fieldset>
            <legend>Authentication</legend>
            
            <div class="form-group">
              <label>
                <input type="checkbox" name="requiresAuth" ${network.requiresAuth ? 'checked' : ''}>
                Requires Authentication
              </label>
            </div>
            
            <div class="auth-options" style="${!network.requiresAuth ? 'display:none' : ''}">
              <div class="form-group">
                <label>Authentication Type</label>
                <select name="authType">
                  <option value="password" ${network.authType === 'password' ? 'selected' : ''}>
                    Password
                  </option>
                  <option value="hacking" ${network.authType === 'hacking' ? 'selected' : ''}>
                    Hacking (Skill Check)
                  </option>
                </select>
              </div>
              
              <div class="auth-password" style="${network.authType !== 'password' ? 'display:none' : ''}">
                <div class="form-group">
                  <label>Password</label>
                  <input type="text" name="password" value="${network.password}">
                </div>
              </div>
              
              <div class="auth-hacking" style="${network.authType !== 'hacking' ? 'display:none' : ''}">
                <div class="form-group split">
                  <div>
                    <label>Skill</label>
                    <select name="hackingSkill">
                      <option value="interface" ${network.hackingSkill === 'interface' ? 'selected' : ''}>
                        Interface
                      </option>
                      <option value="electronics_security" ${network.hackingSkill === 'electronics_security' ? 'selected' : ''}>
                        Electronics/Security
                      </option>
                    </select>
                  </div>
                  <div>
                    <label>DC</label>
                    <input type="number" name="hackingDC" value="${network.hackingDC}" min="10" max="30">
                  </div>
                </div>
              </div>
            </div>
          </fieldset>
          
          <fieldset>
            <legend>Capabilities</legend>
            
            <label>
              <input type="checkbox" name="canSendMessages" ${network.canSendMessages ? 'checked' : ''}>
              Can Send Messages
            </label>
            
            <label>
              <input type="checkbox" name="canAccessShards" ${network.canAccessShards ? 'checked' : ''}>
              Can Access Data Shards
            </label>
          </fieldset>
        </form>
      `,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: 'Save',
          callback: html => {
            const form = html.find('form')[0];
            const data = {
              name: form.name.value,
              description: form.description.value,
              icon: form.icon.value,
              color: form.color.value,
              requiresAuth: form.requiresAuth.checked,
              authType: form.authType?.value || 'password',
              password: form.password?.value || '',
              hackingSkill: form.hackingSkill?.value || 'interface',
              hackingDC: parseInt(form.hackingDC?.value) || 15,
              canSendMessages: form.canSendMessages.checked,
              canAccessShards: form.canAccessShards.checked
            };
            
            options.callback(data);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel'
        }
      },
      default: 'save',
      render: html => {
        // Toggle auth options
        html.find('[name="requiresAuth"]').change(e => {
          html.find('.auth-options').toggle(e.currentTarget.checked);
        });
        
        // Toggle auth type options
        html.find('[name="authType"]').change(e => {
          const type = e.currentTarget.value;
          html.find('.auth-password').toggle(type === 'password');
          html.find('.auth-hacking').toggle(type === 'hacking');
        });
      }
    });
  }
}