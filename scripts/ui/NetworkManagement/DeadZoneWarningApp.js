/**
 * DeadZoneWarningApp
 * @file scripts/ui/NetworkManagement/DeadZoneWarningApp.js
 * @module cyberpunkred-messenger
 * @description Full-screen alert overlay displayed when a player's scene
 *              changes to a dead zone. Shows animated icon, effect tags,
 *              and queue notice. Auto-dismisses after 5 seconds or on click.
 *
 *              Mockup reference: ncm-network-dialogs-mockup.html — Section 3.
 *
 *              Triggered by:
 *              - EVENTS.NETWORK_DISCONNECTED with reason: 'dead_zone'
 *              - Direct call via DeadZoneWarningApp.show(sceneName)
 *
 *              Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, EVENTS, TEMPLATES } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

export class DeadZoneWarningApp extends BaseApplication {

  /** @type {string} The scene name to display */
  _sceneName = 'Unknown Area';

  /** @type {number|null} Auto-dismiss timeout ID */
  _autoDismissTimer = null;

  /** @type {number} Auto-dismiss delay in ms */
  static AUTO_DISMISS_MS = 5000;

  // ─── Service Accessors ───

  get networkService() { return game.nightcity?.networkService; }
  get messageService() { return game.nightcity?.messageService; }

  // ─── ApplicationV2 Configuration ───

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-dead-zone-warning',
    classes: ['ncm-app', 'ncm-dead-zone-warning-dialog'],
    window: {
      title: 'NCM.Network.DeadZone',
      resizable: false,
      minimizable: false,
    },
    position: {
      width: 420,
      height: 'auto',
    },
    actions: {
      acknowledge: DeadZoneWarningApp._onAcknowledge,
    },
  }, { inplace: false });

  static PARTS = {
    main: {
      template: TEMPLATES.DEAD_ZONE_WARNING,
    },
  };

  // ─── Static Factory ───

  /**
   * Show the dead zone warning overlay.
   * Only shows once per dead zone entry — suppresses duplicates if already visible.
   * @param {string} [sceneName] - Name of the dead zone scene
   */
  static show(sceneName) {
    // Check if already open — don't stack
    const existing = Object.values(ui.windows).find(w => w.id === 'ncm-dead-zone-warning');
    if (existing) {
      log.debug('Dead zone warning already visible, skipping duplicate');
      return;
    }

    const app = new DeadZoneWarningApp();
    app._sceneName = sceneName || game.scenes?.viewed?.name || 'Unknown Area';
    app.render(true);
  }

  /**
   * Register EventBus listener for dead zone entry events.
   * Call this during module initialization (e.g. in registerNetworkSystem.js).
   */
  static registerListeners() {
    const eventBus = game.nightcity?.eventBus;
    if (!eventBus) return;

    eventBus.on(EVENTS.NETWORK_DISCONNECTED, (data) => {
      if (data?.reason === 'dead_zone') {
        const sceneName = data.sceneName || game.scenes?.viewed?.name || 'Unknown Area';
        DeadZoneWarningApp.show(sceneName);
      }
    });

    log.debug('DeadZoneWarningApp: EventBus listener registered');
  }

  // ─── Data Preparation ───

  async _prepareContext(options) {
    const queuedMessageCount = this.messageService?.queueSize ?? 0;

    return {
      sceneName: this._sceneName,
      queuedMessageCount,
      hasQueuedMessages: queuedMessageCount > 0,
      MODULE_ID,
    };
  }

  // ─── Lifecycle ───

  _onRender(context, options) {
    super._onRender?.(context, options);

    // Play dead zone sound
    this.soundService?.play('dead-zone');

    // Start auto-dismiss countdown
    this._clearAutoDismiss();
    this._autoDismissTimer = setTimeout(() => {
      this.close();
    }, DeadZoneWarningApp.AUTO_DISMISS_MS);
  }

  _onClose(options) {
    super._onClose?.(options);
    this._clearAutoDismiss();
  }

  // ─── Actions ───

  static _onAcknowledge(event, target) {
    this.close();
  }

  // ─── Helpers ───

  _clearAutoDismiss() {
    if (this._autoDismissTimer !== null) {
      clearTimeout(this._autoDismissTimer);
      this._autoDismissTimer = null;
    }
  }
}
