/**
 * DataShardComposer — Add Messages to Data Shards
 * @file scripts/ui/ItemInbox/DataShardComposer.js
 * @module cyberpunkred-messenger
 * @description Dialog for GMs to add messages/data fragments to data shards.
 */

import { MODULE_ID, DEFAULTS } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

export class DataShardComposer extends BaseApplication {

  shardItem = null;
  onSave = null;

  get dataShardService() { return game.nightcity?.dataShardService; }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-data-shard-composer',
    classes: ['ncm-app', 'ncm-data-shard-composer'],
    window: { title: 'NCM.DataShard.AddMessage', icon: 'fas fa-file-medical', resizable: true, minimizable: false },
    position: { width: 480, height: 420 },
    actions: {
      saveMessage: DataShardComposer._onSaveMessage,
      cancel: DataShardComposer._onCancel,
    },
  }, { inplace: false });

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/item-inbox/data-shard-composer.hbs` },
  };

  constructor(options = {}) {
    super(options);
    if (options.shardItem) this.shardItem = options.shardItem;
    if (options.onSave) this.onSave = options.onSave;
  }

  get title() { return `Add to Shard: ${this.shardItem?.name ?? 'Unknown'}`; }

  async _prepareContext(options) {
    if (!this.shardItem || !isGM()) return { hasItem: false };
    const config = this.dataShardService?.getConfig(this.shardItem) ?? DEFAULTS.SHARD_CONFIG;
    return {
      hasItem: true, shardName: this.shardItem.name,
      isPerMessageEncryption: config.encryptionMode === 'message',
      defaultDC: config.encryptionDC ?? 15,
    };
  }

  static async _onSaveMessage(event, target) {
    if (!isGM() || !this.shardItem) return;
    const form = this.element.querySelector('form');
    if (!form) return;
    const fd = new FormDataExtended(form);
    const data = fd.object;

    if (!data.subject?.trim() && !data.body?.trim()) {
      ui.notifications.warn('NCM | Message needs a subject or body.');
      return;
    }

    const result = await this.dataShardService.addMessage(this.shardItem, {
      from: data.from || 'UNKNOWN',
      subject: data.subject || 'Data Fragment',
      body: data.body || '',
      timestamp: data.timestamp || new Date().toISOString(),
      encrypted: !!data.encrypted,
      encryptionDC: parseInt(data.encryptionDC) || undefined,
    });

    if (result.success) {
      ui.notifications.info('NCM | Message added to shard.');
      if (typeof this.onSave === 'function') this.onSave();
      this.close();
    } else {
      ui.notifications.error(`NCM | Failed: ${result.error}`);
    }
  }

  static _onCancel(event, target) { this.close(); }
}
