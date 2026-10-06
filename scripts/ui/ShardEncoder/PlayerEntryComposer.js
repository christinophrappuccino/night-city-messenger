/**
 * Player Entry Composer — the GM's entry composer, in the player's hands.
 * @file scripts/ui/ShardEncoder/PlayerEntryComposer.js
 * @module night-city-messenger
 * @description The Shard Encoder's Content stage does NOT reimplement authoring: it opens
 *   the REAL `DataShardComposer` (18 types, every WYSIWYG editor, the live preview) with
 *   `playerMode`, which makes it COLLECT instead of persist — the Encoder owns the roll and
 *   the write, so a forgery that fails is never written anywhere.
 *
 *   A subclass exists for exactly two reasons a per-instance option cannot cover:
 *     1. `ADMIN_THEMED` is read as `this.constructor.ADMIN_THEMED`, and this window is
 *        player-facing — it must wear the PLAYER theme, not the GM's admin preset.
 *     2. It needs its own window id, or opening it would collide with a GM composer the
 *        GM already has open on the same world.
 *   Everything else — the actions map, every editor, validation — is inherited untouched.
 *   The parent's `_onSaveEntry` branches on `_playerMode`, so the inherited static actions
 *   (which are bound to the PARENT's methods by name) still do the right thing.
 */

import { DataShardComposer } from '../ItemInbox/DataShardComposer.js';

export class PlayerEntryComposer extends DataShardComposer {

  /** Player-facing: the player's own theme, never the admin preset. */
  static ADMIN_THEMED = false;

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(DataShardComposer.DEFAULT_OPTIONS, {
    id: 'ncm-player-entry-composer',
    classes: ['ncm-app', 'ncm-data-shard-composer', 'ncm-player-composer'],
    window: { title: 'Write the contents', icon: 'fas fa-pen-nib', resizable: true, minimizable: true },
    position: { width: 920, height: 640 },
  }, { inplace: false });

  /**
   * @param {object} options
   * @param {Item}     options.item          the blank being written to (for naming only — nothing is written)
   * @param {string}   [options.type]        the content type to open on
   * @param {string[]} [options.allowedTypes] the GM's allow-list
   * @param {object}   [options.entry]       an entry to reopen for further editing
   * @param {(entry:object)=>void} options.onCollect  handed the finished entry
   */
  constructor(options = {}) {
    super({
      ...options,
      playerMode: true,
      target: { kind: 'shard', item: options.item },
      // Reopening: seed the form from what the player already wrote. No entryId,
      // so it still reads and collects as a NEW entry (the template-load precedent).
      editData: options.entry
        ? { ...options.entry, entryId: undefined }
        : (options.type ? { contentType: options.type } : undefined),
    });
    this._blank = options.item ?? null;
  }

  get title() {
    return this._blank ? `Write the contents — ${this._blank.name}` : 'Write the contents';
  }
}
