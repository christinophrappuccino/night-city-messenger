/**
 * Item Sheet Integration
 * @file scripts/integrations/ItemSheetIntegration.js
 * @module cyberpunkred-messenger
 * @description Hooks into FoundryVTT item sheet rendering to add data shard
 *              controls. GM sees "Convert to Data Shard" button on non-shard
 *              items, and "Open Shard" / "Configure" / "Remove Shard" buttons
 *              on items already converted. Players see "Open Shard" if the
 *              item is a data shard.
 *
 * Integration approach:
 *   - Uses Hooks.on('renderItemSheet') for v1 sheets
 *   - Uses Hooks.on('renderItemSheetV2') for ApplicationV2 sheets
 *   - Injects a small button bar into the sheet header or body
 *   - All buttons delegate to DataShardService and UI apps
 */

import { MODULE_ID } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';

export class ItemSheetIntegration {

  /** @type {boolean} Whether hooks are currently active */
  #active = false;

  /** @type {number[]} Hook IDs for cleanup */
  #hookIds = [];

  /**
   * Activate item sheet hooks.
   * Safe to call multiple times — deduplicates.
   */
  activate() {
    if (this.#active) return;

    // Hook for legacy Application-based sheets (v1)
    const hookV1 = Hooks.on('renderItemSheet', this._onRenderItemSheet.bind(this));
    this.#hookIds.push(hookV1);

    // Hook for ApplicationV2-based sheets
    const hookV2 = Hooks.on('renderItemSheetV2', this._onRenderItemSheetV2.bind(this));
    this.#hookIds.push(hookV2);

    this.#active = true;
    log.debug('ItemSheetIntegration hooks activated');
  }

  /**
   * Deactivate hooks. Cleans up all registered listeners.
   */
  deactivate() {
    for (const id of this.#hookIds) {
      Hooks.off('renderItemSheet', id);
      Hooks.off('renderItemSheetV2', id);
    }
    this.#hookIds = [];
    this.#active = false;
    log.debug('ItemSheetIntegration hooks deactivated');
  }

  // ═══════════════════════════════════════════════════════════════
  //  Hook Handlers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Handle renderItemSheet (Application v1 sheets).
   * @param {ItemSheet} app - The sheet application
   * @param {jQuery} html - The rendered HTML
   * @param {object} data - Template data
   */
  _onRenderItemSheet(app, html, data) {
    const item = app.document ?? app.item ?? app.object;
    if (!item) return;

    try {
      this._injectControls(item, html[0] ?? html, app);
    } catch (err) {
      log.error(`ItemSheetIntegration render error: ${err.message}`);
    }
  }

  /**
   * Handle renderItemSheetV2 (ApplicationV2 sheets).
   * @param {ApplicationV2} app - The sheet application
   * @param {HTMLElement} element - The rendered element
   * @param {object} context - Render context
   */
  _onRenderItemSheetV2(app, element, context) {
    const item = app.document ?? app.item;
    if (!item) return;

    try {
      this._injectControls(item, element, app);
    } catch (err) {
      log.error(`ItemSheetIntegration V2 render error: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Control Injection
  // ═══════════════════════════════════════════════════════════════

  /**
   * Inject data shard controls into the item sheet.
   * @param {Item} item
   * @param {HTMLElement} element
   * @param {Application|ApplicationV2} app
   */
  _injectControls(item, element, app) {
    const dataShardService = game.nightcity?.dataShardService;
    if (!dataShardService) return;

    // Remove any previously injected controls (prevents duplicates on re-render)
    const existing = element.querySelector('.ncm-shard-controls');
    if (existing) existing.remove();

    const isShard = dataShardService.isDataShard(item);
    const gm = isGM();

    // Build the control bar
    const controlBar = document.createElement('div');
    controlBar.classList.add('ncm-shard-controls');
    controlBar.style.cssText = `
      display: flex;
      gap: 4px;
      align-items: center;
      padding: 4px 6px;
      margin: 4px 0;
      border: 1px solid rgba(246, 82, 97, 0.3);
      border-radius: 4px;
      background: rgba(18, 18, 26, 0.6);
      font-family: 'Rajdhani', sans-serif;
      font-size: 12px;
    `;

    if (isShard) {
      // ─── Item IS a Data Shard ───
      this._addShardControls(controlBar, item, gm);
    } else if (gm) {
      // ─── Not a shard yet — GM can convert ───
      this._addConvertControl(controlBar, item);
    } else {
      // Non-shard, non-GM — nothing to show
      return;
    }

    // Find injection point — try header, then form, then body
    const injectionTarget =
      element.querySelector('.sheet-header') ??
      element.querySelector('.window-content > form') ??
      element.querySelector('.window-content') ??
      element.querySelector('form');

    if (injectionTarget) {
      // Insert after the header or at the top of the form
      const header = injectionTarget.querySelector('.sheet-header');
      if (header) {
        header.after(controlBar);
      } else {
        injectionTarget.prepend(controlBar);
      }
    }
  }

  /**
   * Add "Convert to Data Shard" button (GM only, non-shard items).
   * @param {HTMLElement} container
   * @param {Item} item
   */
  _addConvertControl(container, item) {
    const label = document.createElement('span');
    label.style.cssText = 'color: #8888a0; margin-right: 4px;';
    label.innerHTML = '<i class="fas fa-microchip" style="color: #19f3f7; margin-right: 4px;"></i>DATA SHARD';

    const btn = this._createButton('Convert to Shard', 'fas fa-plus-circle', '#19f3f7', async () => {
      const confirmed = await Dialog.confirm({
        title: 'Convert to Data Shard',
        content: `<p>Convert <strong>${item.name}</strong> into a data shard?</p>
                  <p style="font-size: 11px; color: #8888a0;">
                    This adds shard data to the item's flags. The item itself is preserved.
                    You can remove shard status later via the configure panel.
                  </p>`,
      });

      if (confirmed) {
        try {
          await game.nightcity.dataShardService.convertToDataShard(item);
          ui.notifications.info(`"${item.name}" converted to data shard`);

          // Open config dialog automatically
          const { ItemInboxConfig } = await import('../ui/ItemInbox/ItemInboxConfig.js');
          const configApp = new ItemInboxConfig({ item });
          configApp.render(true);
        } catch (err) {
          ui.notifications.error(`Failed to convert: ${err.message}`);
        }
      }
    });

    container.append(label, btn);
  }

  /**
   * Add shard-specific controls (Open, Configure, Remove).
   * @param {HTMLElement} container
   * @param {Item} item
   * @param {boolean} gm
   */
  _addShardControls(container, item, gm) {
    // Shard indicator
    const indicator = document.createElement('span');
    indicator.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 3px;
      background: rgba(246, 82, 97, 0.15);
      color: #F65261;
      border: 1px solid rgba(246, 82, 97, 0.3);
      font-size: 10px;
      font-family: 'Share Tech Mono', monospace;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-right: 4px;
    `;
    indicator.innerHTML = '<i class="fas fa-microchip"></i> DATA SHARD';
    container.append(indicator);

    // Encryption badge if applicable
    const config = game.nightcity.dataShardService.getConfig(item);
    if (config.encrypted) {
      const iceBadge = document.createElement('span');
      const iceColor = config.encryptionType === 'RED_ICE' ? '#ff2222' :
                       config.encryptionType === 'BLACK_ICE' ? '#ff0000' : '#ffcc00';
      iceBadge.style.cssText = `
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 9px;
        font-family: 'Share Tech Mono', monospace;
        background: rgba(255, 0, 0, 0.15);
        color: ${iceColor};
        border: 1px solid ${iceColor};
        margin-right: 4px;
      `;
      iceBadge.textContent = config.encryptionType || 'ICE';
      container.append(iceBadge);
    }

    // Spacer
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    container.append(spacer);

    // Open Shard button (everyone)
    const openBtn = this._createButton('Open', 'fas fa-folder-open', '#19f3f7', () => {
      game.nightcity.openDataShard?.(item);
    });
    container.append(openBtn);

    if (gm) {
      // Configure button
      const configBtn = this._createButton('Configure', 'fas fa-cog', '#f7c948', async () => {
        const { ItemInboxConfig } = await import('../ui/ItemInbox/ItemInboxConfig.js');
        const configApp = new ItemInboxConfig({ item });
        configApp.render(true);
      });
      container.append(configBtn);

      // Remove Shard button
      const removeBtn = this._createButton('Remove', 'fas fa-trash', '#ff4444', async () => {
        const confirmed = await Dialog.confirm({
          title: 'Remove Data Shard',
          content: `<p>Remove data shard status from <strong>${item.name}</strong>?</p>
                    <p style="font-size: 11px; color: #ff4444;">
                      This will delete all shard configuration, messages, and security settings.
                      The item itself will be preserved.
                    </p>`,
        });

        if (confirmed) {
          try {
            await game.nightcity.dataShardService.removeDataShard(item);
            ui.notifications.info(`Shard status removed from "${item.name}"`);
          } catch (err) {
            ui.notifications.error(`Failed: ${err.message}`);
          }
        }
      });
      container.append(removeBtn);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Utilities
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create a styled mini-button.
   * @param {string} label
   * @param {string} iconClass
   * @param {string} color
   * @param {Function} onClick
   * @returns {HTMLButtonElement}
   */
  _createButton(label, iconClass, color, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.05);
      color: ${color};
      border: 1px solid ${color}44;
      font-size: 11px;
      font-family: 'Rajdhani', sans-serif;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    `;
    btn.innerHTML = `<i class="${iconClass}"></i> ${label}`;

    // Hover effect
    btn.addEventListener('mouseenter', () => {
      btn.style.background = `${color}22`;
      btn.style.borderColor = color;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(255, 255, 255, 0.05)';
      btn.style.borderColor = `${color}44`;
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });

    return btn;
  }
}
