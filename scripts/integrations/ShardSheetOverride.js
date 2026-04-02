/**
 * Shard Sheet Override
 * @file scripts/integrations/ShardSheetOverride.js
 * @module cyberpunkred-messenger
 * @description Replaces the old ItemSheetIntegration with three hooks:
 *
 *   1. **Sheet Interception** — `preRenderItemSheet` prevents the default
 *      Foundry item sheet from opening when an item is a data shard.
 *      Instead, launches the NCM shard viewer (ItemInboxApp).
 *      GM can bypass via "View Original Item" button in the shard viewer header.
 *
 *   2. **Inventory Badges** — `renderActorSheet` injects a cyan microchip
 *      icon and left border on items flagged as data shards.
 *      Non-shard items get a conversion button (if setting allows).
 *
 *   3. **Context Menu** — `getActorSheetItemContext` adds:
 *      - "Convert to Data Shard" on non-shard items (GM or players if enabled)
 *      - "Open Data Shard" / "Configure Shard" / "Remove Shard Data" on shard items
 */

import { MODULE_ID } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';

export class ShardSheetOverride {

  /** @type {boolean} Whether hooks are currently active */
  #active = false;

  /** @type {number[]} Hook IDs for cleanup */
  #hookIds = [];

  // ═══════════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════════

  /**
   * Activate all three hooks. Safe to call multiple times.
   */
  activate() {
    if (this.#active) return;

    const h1 = Hooks.on('renderItemSheet', this._onRenderItemSheet.bind(this));
    const h2 = Hooks.on('renderActorSheet', this._onRenderActorSheet.bind(this));
    const h3 = Hooks.on('getActorSheetItemContext', this._onGetItemContext.bind(this));

    this.#hookIds.push(
      { event: 'renderItemSheet', id: h1 },
      { event: 'renderActorSheet', id: h2 },
      { event: 'getActorSheetItemContext', id: h3 },
    );

    this.#active = true;
    log.debug('ShardSheetOverride: 3 hooks activated');
  }

  /**
   * Deactivate all hooks.
   */
  deactivate() {
    for (const { event, id } of this.#hookIds) {
      Hooks.off(event, id);
    }
    this.#hookIds = [];
    this.#active = false;
    log.debug('ShardSheetOverride: hooks deactivated');
  }

  // ═══════════════════════════════════════════════════════════════
  //  1. Sheet Interception — renderItemSheet (close & redirect)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Intercept item sheet after it renders. If the item is a data shard,
   * immediately close the Foundry sheet and open our shard viewer.
   *
   * Uses renderItemSheet (post-render) instead of preRenderItemSheet
   * because preRender's `return false` doesn't reliably prevent rendering
   * across all Foundry versions and system sheet classes.
   *
   * The `_ncmBypass` flag on the sheet allows the GM's "View Original
   * Item" button to open the native Foundry sheet without looping.
   *
   * @param {ItemSheet} sheet - The item sheet application
   * @param {jQuery|HTMLElement} html - The rendered HTML
   * @param {object} data - Template data
   */
  _onRenderItemSheet(sheet, html, data) {
    try {
      const item = sheet.document ?? sheet.object;
      if (!item) return;

      // GM bypass — let the Foundry sheet stay open
      if (sheet._ncmBypass) {
        sheet._ncmBypass = false;
        return;
      }

      // Not a shard — nothing to intercept
      if (!item.getFlag(MODULE_ID, 'isDataShard')) return;

      // Launch our shard viewer
      const openFn = game.nightcity?.openDataShard;
      if (openFn) {
        // Close the Foundry sheet, then open the shard viewer
        sheet.close({ force: true });
        openFn(item);
      } else {
        log.warn('ShardSheetOverride: openDataShard not available, leaving default sheet open');
      }
    } catch (err) {
      log.error(`ShardSheetOverride: renderItemSheet intercept error — ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  2. Inventory Badges — renderActorSheet
  // ═══════════════════════════════════════════════════════════════

  /**
   * After the actor sheet renders, scan inventory items and:
   *   - Add cyan left border + microchip badge to shard items
   *   - Add a conversion button to non-shard items (if allowed)
   *
   * @param {ActorSheet} sheet
   * @param {jQuery|HTMLElement} html
   * @param {object} data
   */
  _onRenderActorSheet(sheet, html, data) {
    try {
      const actor = sheet.actor ?? sheet.document;
      if (!actor?.items) return;

      const root = html[0] ?? html;
      const canConvert = isGM() || game.settings.get(MODULE_ID, 'allowPlayerConversion');

      for (const item of actor.items) {
        const isShard = item.getFlag(MODULE_ID, 'isDataShard');
        // Find the item row — CPR uses data-item-id
        const row = root.querySelector(`[data-item-id="${item.id}"]`);
        if (!row) continue;

        if (isShard) {
          this._applyShardBadge(row, item);
        } else if (canConvert) {
          this._applyConvertButton(row, item, actor);
        }
      }
    } catch (err) {
      log.error(`ShardSheetOverride: renderActorSheet error — ${err.message}`);
    }
  }

  /**
   * Add visual shard indicators to an inventory row and intercept clicks
   * so the default Foundry item sheet never opens for shard items.
   *
   * Option B: Corner chip tag overlaid on the item image thumbnail.
   * Plus a click interceptor on the item name that opens the shard viewer
   * directly, preventing CPR's default "open item sheet" handler.
   *
   * @param {HTMLElement} row
   * @param {Item} item
   */
  _applyShardBadge(row, item) {
    // Don't double-badge on re-render
    if (row.querySelector('.ncm-shard-img-tag')) return;

    // ─── Corner tag on item image ───
    const imgEl = row.querySelector('.item-image, img, .item-icon');
    if (imgEl) {
      // Make the image container positioned so we can overlay
      const imgContainer = imgEl.closest('.item-image') ?? imgEl.parentElement;
      if (imgContainer) {
        imgContainer.style.position = 'relative';
        imgContainer.style.overflow = 'visible';
      }

      const tag = document.createElement('div');
      tag.className = 'ncm-shard-img-tag';
      tag.innerHTML = '<i class="fas fa-microchip"></i>';
      tag.title = 'Data Shard';
      (imgContainer ?? imgEl).appendChild(tag);
    }

    // ─── Click intercept on item name ───
    // CPR binds its "open item sheet" handler to .item-name clicks.
    // We intercept with stopImmediatePropagation so it never fires.
    const nameEl = row.querySelector('.item-name');
    if (nameEl) {
      nameEl.addEventListener('click', (ev) => {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        game.nightcity?.openDataShard(item);
      }, { capture: true });
    }

    // Also intercept on the image (some sheets open on image click too)
    if (imgEl) {
      const clickTarget = imgEl.closest('.item-image') ?? imgEl;
      clickTarget.addEventListener('click', (ev) => {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        game.nightcity?.openDataShard(item);
      }, { capture: true });
    }
  }

  /**
   * Add a "Convert to Data Shard" button to the item controls area.
   * @param {HTMLElement} row
   * @param {Item} item
   * @param {Actor} actor
   */
  _applyConvertButton(row, item, actor) {
    if (row.querySelector('.ncm-convert-shard-btn')) return;

    const controls = row.querySelector('.item-controls, .item-control');
    if (!controls) return;

    const btn = document.createElement('a');
    btn.className = 'item-control ncm-convert-shard-btn';
    btn.title = 'Convert to Data Shard';
    btn.innerHTML = '<i class="fas fa-microchip"></i>';
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      this._launchConversionFlow(item, actor);
    });

    // Insert at the start of controls
    controls.prepend(btn);
  }

  // ═══════════════════════════════════════════════════════════════
  //  3. Context Menu — getActorSheetItemContext
  // ═══════════════════════════════════════════════════════════════

  /**
   * Add shard-related entries to the right-click context menu.
   * @param {ActorSheet} sheet
   * @param {Array} options - Context menu option array
   */
  _onGetItemContext(sheet, options) {
    try {
      const actor = sheet.actor ?? sheet.document;
      if (!actor) return;

      const canConvert = isGM() || game.settings.get(MODULE_ID, 'allowPlayerConversion');

      // ─── Convert to Data Shard (non-shard items) ───
      if (canConvert) {
        options.push({
          name: 'Convert to Data Shard',
          icon: '<i class="fas fa-microchip" style="color:#00D4E6;"></i>',
          condition: (li) => {
            const item = actor.items.get(li.data('itemId') ?? li.dataset?.itemId);
            return item && !item.getFlag(MODULE_ID, 'isDataShard');
          },
          callback: (li) => {
            const item = actor.items.get(li.data('itemId') ?? li.dataset?.itemId);
            if (item) this._launchConversionFlow(item, actor);
          },
        });
      }

      // ─── Open Data Shard (shard items — everyone) ───
      options.push({
        name: 'Open Data Shard',
        icon: '<i class="fas fa-hard-drive" style="color:#00D4E6;"></i>',
        condition: (li) => {
          const item = actor.items.get(li.data('itemId') ?? li.dataset?.itemId);
          return item?.getFlag(MODULE_ID, 'isDataShard') === true;
        },
        callback: (li) => {
          const item = actor.items.get(li.data('itemId') ?? li.dataset?.itemId);
          if (item) game.nightcity?.openDataShard(item);
        },
      });

      // ─── GM-only: Configure Shard ───
      if (isGM()) {
        options.push({
          name: 'Configure Shard',
          icon: '<i class="fas fa-sliders" style="color:#00D4E6;"></i>',
          condition: (li) => {
            const item = actor.items.get(li.data('itemId') ?? li.dataset?.itemId);
            return item?.getFlag(MODULE_ID, 'isDataShard') === true;
          },
          callback: async (li) => {
            const item = actor.items.get(li.data('itemId') ?? li.dataset?.itemId);
            if (!item) return;
            try {
              const { ItemInboxConfig } = await import('../ui/ItemInbox/ItemInboxConfig.js');
              const configApp = new ItemInboxConfig({ item });
              configApp.render(true);
            } catch (err) {
              log.error(`ShardSheetOverride: Failed to open config — ${err.message}`);
            }
          },
        });
      }

      // ─── GM-only: Remove Shard Data ───
      if (isGM()) {
        options.push({
          name: 'Remove Shard Data',
          icon: '<i class="fas fa-microchip" style="color:#F65261;"></i>',
          condition: (li) => {
            const item = actor.items.get(li.data('itemId') ?? li.dataset?.itemId);
            return item?.getFlag(MODULE_ID, 'isDataShard') === true;
          },
          callback: (li) => {
            const item = actor.items.get(li.data('itemId') ?? li.dataset?.itemId);
            if (item) this._confirmUnconvert(item);
          },
        });
      }
    } catch (err) {
      log.error(`ShardSheetOverride: context menu error — ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Action Helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Launch the shard conversion flow for an item.
   * For now this uses the existing DataShardService.convertToDataShard
   * with a confirmation dialog. The full multi-step wizard
   * (ShardConversionFlow) will replace this once built.
   *
   * @param {Item} item
   * @param {Actor} actor
   */
  async _launchConversionFlow(item, actor) {
    const dataShardService = game.nightcity?.dataShardService;
    if (!dataShardService) {
      ui.notifications.error('Night City Messenger: DataShardService not available');
      return;
    }

    // TODO: Replace with ShardConversionFlow ApplicationV2 (tier-gated wizard)
    const confirmed = await Dialog.confirm({
      title: 'Convert to Data Shard',
      content: `<p>Convert <strong>${item.name}</strong> into a data shard?</p>
                <p style="font-size: 11px; color: #8888a0;">
                  This adds shard data to the item's flags. The item itself is preserved.
                  You can remove shard status later via right-click → Remove Shard Data.
                </p>`,
    });

    if (confirmed) {
      try {
        const result = await dataShardService.convertToDataShard(item);
        if (result.success) {
          ui.notifications.info(`"${item.name}" converted to data shard`);
        } else {
          ui.notifications.error(`Failed to convert: ${result.error}`);
        }
      } catch (err) {
        ui.notifications.error(`Failed to convert: ${err.message}`);
      }
    }
  }

  /**
   * Show a confirmation dialog to strip shard data from an item.
   * GM only.
   *
   * @param {Item} item
   */
  async _confirmUnconvert(item) {
    const dataShardService = game.nightcity?.dataShardService;
    if (!dataShardService) return;

    const confirmed = await Dialog.confirm({
      title: 'Remove Shard Data',
      content: `<div style="font-family: Rajdhani, sans-serif;">
        <p>Strip all shard data from <strong style="color:#19f3f7;">${item.name}</strong>?</p>
        <div style="font-size: 11px; color: #8888a0; padding: 8px 10px; background: rgba(255,0,51,0.04); border: 1px solid rgba(255,0,51,0.15); border-radius: 2px; margin-top: 8px; line-height: 1.7;">
          <i class="fas fa-exclamation-circle" style="color: #ff0033; margin-right: 4px;"></i>
          This will permanently remove:<br>
          &nbsp;&nbsp;• Shard content and configuration<br>
          &nbsp;&nbsp;• ICE protection settings<br>
          &nbsp;&nbsp;• Linked journal entry<br>
          &nbsp;&nbsp;• Boot sequence and preset<br>
          <br>
          The original item will be preserved.
        </div>
      </div>`,
    });

    if (confirmed) {
      try {
        const result = await dataShardService.removeDataShard(item);
        if (result?.success !== false) {
          ui.notifications.info(`Shard data removed from "${item.name}"`);
        } else {
          ui.notifications.error(`Failed: ${result.error}`);
        }
      } catch (err) {
        ui.notifications.error(`Failed to remove shard data: ${err.message}`);
      }
    }
  }
}
