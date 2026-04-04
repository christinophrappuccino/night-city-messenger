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
import { ShardConversionFlow } from '../ui/dialogs/ShardConversionFlow.js';

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

    const bind = (event, handler) => {
      const id = Hooks.on(event, handler);
      this.#hookIds.push({ event, id });
    };

    const dirHandler = this._onRenderItemDirectory.bind(this);

    // Sheet intercept — catches items opened via item.sheet.render()
    bind('renderItemSheet', this._onRenderItemSheet.bind(this));
    // CPR uses ApplicationV2 which only fires class-specific hooks
    bind('renderCPRItemSheet', this._onRenderItemSheet.bind(this));

    // Actor sheet — badges, click intercepts, context menus on inventory items
    bind('renderActorSheet', this._onRenderActorSheet.bind(this));

    // Items Directory sidebar — try multiple hook names for v12 compat
    bind('renderItemDirectory', dirHandler);
    bind('renderDocumentDirectory', dirHandler);

    // Sidebar tab switch — re-inject badges after tab changes
    bind('changeSidebarTab', (tab) => {
      if (tab?.id === 'items' || tab?.tabName === 'items') {
        setTimeout(() => dirHandler(tab, tab.element, {}), 50);
      }
    });

    this.#active = true;
    log.debug('ShardSheetOverride: hooks activated');
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
      // Use requestAnimationFrame to clear so both renderItemSheet
      // and renderCPRItemSheet see the flag before it's cleared
      if (sheet._ncmBypass) {
        requestAnimationFrame(() => { sheet._ncmBypass = false; });
        return;
      }

      // Not a shard — nothing to intercept
      if (!item.getFlag(MODULE_ID, 'isDataShard')) return;

      // Launch our shard viewer
      const openFn = game.nightcity?.openDataShard;
      if (openFn) {
        // Hide the sheet element instantly to prevent visual flash
        const el = sheet.element?.[0] ?? sheet.element;
        if (el) el.style.display = 'none';
        // Close and redirect
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
  //  1b. Items Directory — renderItemDirectory
  // ═══════════════════════════════════════════════════════════════

  /**
   * After the Items Directory sidebar renders, scan items and:
   *   - Add corner chip badge to shard item thumbnails
   *   - Intercept left-clicks on shards to open the shard viewer
   *   - On right-click, inject NCM options into Foundry's rendered context menu
   */
  _onRenderItemDirectory(app, html, data) {
    try {
      const isItemsDir = app?.constructor?.name?.includes?.('Item')
        || app?.collection?.documentName === 'Item'
        || app?.id === 'items'
        || app?.tabName === 'items';
      if (!isItemsDir) {
        if (app?.constructor?.name?.includes?.('Document') && app?.collection?.documentName !== 'Item') return;
        if (!isItemsDir && app?.constructor?.name) return;
      }

      let root = html?.[0] ?? html;
      if (!root?.querySelector) root = app?.element?.[0] ?? app?.element;
      if (!root?.querySelector) return;

      for (const item of (game.items ?? [])) {
        const isShard = item.getFlag(MODULE_ID, 'isDataShard');

        const entry = root.querySelector(`[data-document-id="${item.id}"]`)
          ?? root.querySelector(`[data-entry-id="${item.id}"]`)
          ?? root.querySelector(`[data-item-id="${item.id}"]`);
        if (!entry) continue;
        if (entry.dataset.ncmProcessed) continue;
        entry.dataset.ncmProcessed = 'true';

        if (isShard) {
          // ─── Corner badge on thumbnail ───
          const thumb = entry.querySelector('img.thumbnail, img');
          if (thumb) {
            entry.style.position = 'relative';
            entry.style.overflow = 'visible';

            const tag = document.createElement('div');
            tag.className = 'ncm-shard-img-tag';
            tag.innerHTML = '<i class="fas fa-microchip"></i>';
            tag.title = 'Data Shard';
            entry.appendChild(tag);

            const positionBadge = () => {
              const imgRect = thumb.getBoundingClientRect();
              const entryRect = entry.getBoundingClientRect();
              tag.style.top = (imgRect.top - entryRect.top + imgRect.height - 12) + 'px';
              tag.style.left = (imgRect.left - entryRect.left + imgRect.width - 12) + 'px';
            };
            requestAnimationFrame(positionBadge);
          }

          // ─── Left-click intercept (shard items only) ───
          const interceptClick = (ev) => {
            if (ev.button !== 0 || ev.ctrlKey || ev.metaKey) return;
            ev.stopImmediatePropagation();
            ev.preventDefault();
            game.nightcity?.openDataShard(item);
          };
          for (const sel of ['.document-name a', '.document-name', '.entry-name a', '.entry-name', 'h4 a', 'h4']) {
            const el = entry.querySelector(sel);
            if (el) { el.addEventListener('click', interceptClick, { capture: true }); break; }
          }
          if (thumb) thumb.addEventListener('click', interceptClick, { capture: true });
        }

        // ─── Right-click: inject into Foundry's context menu after it renders ───
        entry.addEventListener('contextmenu', () => {
          setTimeout(() => this._injectDirectoryContextOptions(item, isShard), 80);
        });
      }
    } catch (err) {
      log.error(`ShardSheetOverride: renderItemDirectory error — ${err.message}`);
    }
  }

  /**
   * Inject NCM options into Foundry's already-rendered context menu.
   * Called 80ms after right-click so Foundry's menu is in the DOM.
   * Appends our options after a separator at the bottom of the existing menu.
   *
   * @param {Item} item
   * @param {boolean} isShard
   */
  _injectDirectoryContextOptions(item, isShard) {
    const menu = document.querySelector('#context-menu');
    if (!menu) return;

    const ol = menu.querySelector('ol, ul, .context-items') ?? menu;

    const addOption = (label, icon, color, fn) => {
      const li = document.createElement('li');
      li.className = 'context-item';
      li.innerHTML = `<i class="${icon}" style="color:${color};margin-right:6px;"></i> ${label}`;
      li.style.cssText = 'cursor:pointer;padding:4px 8px;white-space:nowrap;';
      li.addEventListener('click', (ev) => {
        ev.stopPropagation();
        menu.remove();
        document.querySelector('.context-overlay')?.remove();
        fn();
      });
      li.addEventListener('mouseenter', () => { li.style.background = 'rgba(255,255,255,0.06)'; });
      li.addEventListener('mouseleave', () => { li.style.background = ''; });
      ol.appendChild(li);
    };

    // Separator before our options
    const sep = document.createElement('li');
    sep.style.cssText = 'height:1px;background:#555;margin:3px 0;';
    ol.appendChild(sep);

    if (isShard) {
      addOption('Open Data Shard', 'fas fa-hard-drive', '#00D4E6', () => game.nightcity?.openDataShard(item));
      if (isGM()) {
        addOption('Configure Shard', 'fas fa-sliders', '#00D4E6', async () => {
          const { ItemInboxConfig } = await import('../ui/ItemInbox/ItemInboxConfig.js');
          new ItemInboxConfig({ item }).render(true);
        });
        addOption('View Original Item', 'fas fa-file-alt', '#f7c948', () => {
          const sheet = item.sheet;
          if (sheet) { sheet._ncmBypass = true; sheet.render(true); }
        });
        addOption('Remove Shard Data', 'fas fa-rotate-left', '#F65261', () => this._confirmUnconvert(item));
      }
    } else if (isGM()) {
      addOption('Convert to Data Shard', 'fas fa-microchip', '#00D4E6', () => this._launchConversionFlow(item));
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
      const canConvert = isGM() || game.settings.get(MODULE_ID, 'playerShardFloor') !== 'disabled';

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

    // ─── Right-click context menu ───
    row.addEventListener('contextmenu', (ev) => {
      // Only intercept if not already handled by Foundry
      const entries = [
        { label: 'Open Data Shard', icon: 'fas fa-hard-drive', color: '#00D4E6', fn: () => game.nightcity?.openDataShard(item) },
      ];
      if (isGM()) {
        entries.push(
          { label: 'Configure Shard', icon: 'fas fa-sliders', color: '#00D4E6', fn: async () => {
            const { ItemInboxConfig } = await import('../ui/ItemInbox/ItemInboxConfig.js');
            new ItemInboxConfig({ item }).render(true);
          }},
          { label: 'View Original Item', icon: 'fas fa-file-alt', color: '#f7c948', fn: () => {
            const sheet = item.sheet;
            if (sheet) { sheet._ncmBypass = true; sheet.render(true); }
          }},
          { sep: true },
          { label: 'Remove Shard Data', icon: 'fas fa-rotate-left', color: '#F65261', fn: () => this._confirmUnconvert(item) },
        );
      }
      this._showContextMenu(ev, entries);
    });
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

    // ─── Right-click context menu ───
    row.addEventListener('contextmenu', (ev) => {
      if (!isGM() && game.settings.get(MODULE_ID, 'playerShardFloor') === 'disabled') return;
      const entries = [
        { label: 'Convert to Data Shard', icon: 'fas fa-microchip', color: '#00D4E6', fn: () => this._launchConversionFlow(item, actor) },
      ];
      this._showContextMenu(ev, entries);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  Custom Context Menu
  // ═══════════════════════════════════════════════════════════════

  /**
   * Show a lightweight custom context menu at the cursor position.
   * Replaces getActorSheetItemContext since CPR doesn't fire that hook.
   *
   * @param {MouseEvent} ev
   * @param {Array<{label: string, icon: string, color?: string, fn: Function}|{sep: true}>} entries
   */
  _showContextMenu(ev, entries) {
    ev.preventDefault();
    ev.stopPropagation();

    // Remove any existing NCM context menu
    document.querySelectorAll('.ncm-ctx-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'ncm-ctx-menu';

    for (const entry of entries) {
      if (entry.sep) {
        const sep = document.createElement('div');
        sep.className = 'ncm-ctx-menu__sep';
        menu.appendChild(sep);
        continue;
      }

      const item = document.createElement('div');
      item.className = 'ncm-ctx-menu__item';
      item.innerHTML = `<i class="${entry.icon}" style="color:${entry.color || '#ccc'};"></i> ${entry.label}`;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.remove();
        entry.fn();
      });
      menu.appendChild(item);
    }

    // Position at cursor
    menu.style.left = `${ev.clientX}px`;
    menu.style.top = `${ev.clientY}px`;
    document.body.appendChild(menu);

    // Close on any outside click or scroll
    const close = () => {
      menu.remove();
      document.removeEventListener('click', close, true);
      document.removeEventListener('contextmenu', close, true);
      document.removeEventListener('scroll', close, true);
    };
    // Delay binding so this click doesn't immediately close it
    requestAnimationFrame(() => {
      document.addEventListener('click', close, true);
      document.addEventListener('contextmenu', close, true);
      document.addEventListener('scroll', close, true);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  Action Helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Launch the shard conversion flow for an item.
   * Opens the tier-gated ShardConversionFlow wizard which handles
   * skill checks, form collection, and conversion.
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

    // Check if already a shard
    if (item.getFlag(MODULE_ID, 'isDataShard')) {
      ui.notifications.warn('This item is already a data shard.');
      return;
    }

    // Check tier availability for players
    if (!isGM()) {
      const floor = game.settings.get(MODULE_ID, 'playerShardFloor') || 'disabled';
      if (floor === 'disabled') {
        ui.notifications.warn('Shard creation is disabled for players.');
        return;
      }
    }

    new ShardConversionFlow(item, actor).render(true);
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
          setTimeout(() => {
            ui.items?.render();
            for (const sheet of Object.values(ui.windows)) {
              if (sheet.actor?.items?.has(item.id)) sheet.render(false);
            }
          }, 150);
        } else {
          ui.notifications.error(`Failed: ${result.error}`);
        }
      } catch (err) {
        ui.notifications.error(`Failed to remove shard data: ${err.message}`);
      }
    }
  }
}
