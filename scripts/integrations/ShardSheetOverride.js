/**
 * Shard Sheet Override
 * @file scripts/integrations/ShardSheetOverride.js
 * @module night-city-messenger
 * @description Replaces the old ItemSheetIntegration with three hooks:
 *
 *   1. **Sheet Interception** — `preRenderItemSheet` prevents the default
 *      Foundry item sheet from opening when an item is a data shard.
 *      Instead, launches the NCM shard viewer (ItemInboxApp).
 *      GM can bypass via the "Edit Item Sheet" button in the shard viewer header.
 *
 *   2. **Inventory Badges** — `renderActorSheet` injects a cyan microchip
 *      icon and left border on items flagged as data shards.
 *      Non-shard items get a conversion button (if setting allows).
 *
 *   3. **Context Menu** — `getActorSheetItemContext` adds:
 *      - "Convert to Data Shard" on non-shard items (GM or players if enabled)
 *      - "Open Data Shard" / "Configure Shard" / "Remove Shard Data" on shard items
 */

import { accessMenuEntries } from './AccessPoints.js';
import { MODULE_ID, SOCKET_OPS } from '../utils/constants.js';
import { log, isGM, canEncode, canEditShard, resolveOperator } from '../utils/helpers.js';
import { themedConfirm, themedPrompt } from '../utils/adminTheme.js';
import { dialogBodyHtml } from '../utils/dialogBody.js';
import { withShardPrefix, stripShardPrefix } from '../utils/shardNaming.js';
import { shardTerm as T, withArticle } from '../utils/shardTerm.js';
import { resolveEncoderConfig, isEligibleBlank, blankRuleRefusal } from '../ui/content/EncoderModel.js';

export class ShardSheetOverride {

  /**
   * May this character author shards? The item-sheet doors' copy of the ONE
   * answer — `canEncode` in helpers.js — which the Agent pill, the Program Deck,
   * the Encoder window and its funnel all read too.
   *
   * It replaced a pair of statics (`encoderEnabled` / `playerAuthoringOn`) that
   * existed only because there used to be TWO authoring routes with separate
   * switches. With the tier-gated wizard retired there is one route, so there is
   * one question.
   *
   * @param {Actor|null} actor the character whose sheet the row belongs to
   */
  static canAuthor(actor = null) {
    return canEncode(actor).ok;
  }

  /** The GM's Encoder config, resolved. */
  static _encoderConfig() {
    return resolveEncoderConfig(game.nightcity?.settingsManager?.getEncoderConfigRaw?.() ?? {});
  }

  /** May this item become a player-made shard? (`blanks.source` in the Encoder config.) */
  static isBlankFor(item) {
    return isEligibleBlank(this._encoderConfig(), {
      name: item?.name, type: item?.type, tierId: item?.getFlag?.(MODULE_ID, 'blankTier') || '',
    });
  }

  /** The sentence a player gets for an item that cannot be a blank. */
  static blankRefusal() {
    return blankRuleRefusal(this._encoderConfig());
  }

  /**
   * Who may rename a shard: the GM always; a player when they own the item and
   * the shard's own editing rule would let them rewrite it (`canEditShard`).
   */
  /**
   * The point a sub-menu opens at: right of the row it came from (measured while the row was still on
   * screen), else the cursor. A zero-size box means the row was already detached — use the cursor.
   */
  static _subMenuAt(rect, ev) {
    const ok = rect && rect.width > 0 && rect.height > 0;
    return { clientX: ok ? rect.right + 2 : (ev?.clientX ?? 200), clientY: ok ? rect.top - 4 : (ev?.clientY ?? 200), preventDefault() {}, stopPropagation() {} };
  }

  static canRename(item, actor) {
    if (isGM()) return true;
    return !!item?.isOwner && canEditShard(item, actor).ok;
  }

  /**
   * Rename a shard. The display name (`config.shardName`) and the item name are
   * written TOGETHER — the viewer title prefers the display name, so renaming
   * only the item looked like it had not stuck. The name prefix is kept.
   */
  async _renameShard(item) {
    if (!ShardSheetOverride.canRename(item, resolveOperator())) return;
    const prefix = game.nightcity?.settingsManager?.getShardNamePrefix?.() || '';
    const current = item.getFlag(MODULE_ID, 'config')?.shardName || stripShardPrefix(item.name, prefix);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const label = await themedPrompt({
      title: `Rename ${T('short')}`,
      label: 'Rename', icon: 'fas fa-i-cursor',
      content: dialogBodyHtml({
        icon: 'fas fa-microchip', img: item.img, title: current, sub: item.parent?.name ? `carried by ${item.parent.name}` : '', kind: T('short'),
        field: { name: 'ncmShardRename', label: 'New name', value: current },
        hint: prefix ? `It will be listed in the Items sidebar as "${prefix}…".` : '',
      }),
      read: (root) => root.querySelector('[name="ncmShardRename"]')?.value?.trim() || '',
    });
    if (!label || label === current) return;
    try {
      await item.update({
        name: withShardPrefix(label, prefix),
        [`flags.${MODULE_ID}.config.shardName`]: label,
      });
      ui.notifications.info(`Renamed to "${label}".`);
      this._refreshItemViews(item);
    } catch (err) {
      log.warn('ShardSheetOverride: rename failed', err);
      ui.notifications.warn(`NCM | Could not rename "${item.name}" — you may not have permission to edit it.`);
    }
  }

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
    // CPR uses ApplicationV2 which fires class-specific hooks
    bind('renderActorSheet', this._onRenderActorSheet.bind(this));
    bind('renderCPRActorSheet', this._onRenderActorSheet.bind(this));
    bind('renderCPRCharacterActorSheet', this._onRenderActorSheet.bind(this));
    bind('renderCPRMookActorSheet', this._onRenderActorSheet.bind(this));
    bind('renderCPRContainerActorSheet', this._onRenderActorSheet.bind(this));

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
   * The `_ncmBypass` flag on the sheet allows the GM's "Edit Item Sheet"
   * button to open the native Foundry sheet without looping.
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
        const isTerminal = !!item.getFlag(MODULE_ID, 'isTerminal');

        const entry = root.querySelector(`[data-document-id="${item.id}"]`)
          ?? root.querySelector(`[data-entry-id="${item.id}"]`)
          ?? root.querySelector(`[data-item-id="${item.id}"]`);
        if (!entry) continue;
        if (entry.dataset.ncmProcessed) continue;
        entry.dataset.ncmProcessed = 'true';

        if (isShard) {
          // ─── Corner badge on thumbnail ───
          // Wrap the image in a tightly-bounded positioned span so the badge
          // anchors to the image with pure CSS (bottom: -2px; right: -2px),
          // not to the entry row (which can be flex/right-aligned and push
          // the badge off-screen).
          const thumb = entry.querySelector('img.thumbnail, img');
          if (thumb && !thumb.parentElement?.classList.contains('ncm-shard-thumb-wrap')) {
            const wrap = document.createElement('span');
            wrap.className = 'ncm-shard-thumb-wrap';
            wrap.style.cssText = 'position:relative; display:inline-block; line-height:0; overflow:visible; vertical-align:middle;';
            thumb.parentNode.insertBefore(wrap, thumb);
            wrap.appendChild(thumb);

            const tag = document.createElement('div');
            tag.className = 'ncm-shard-img-tag';
            tag.innerHTML = '<i class="fas fa-microchip"></i>';
            tag.title = T('one');
            wrap.appendChild(tag);
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
        } else if (isTerminal) {
          // Terminal badge + left-click → open the terminal.
          const thumb = entry.querySelector('img.thumbnail, img');
          if (thumb && !thumb.parentElement?.classList.contains('ncm-shard-thumb-wrap')) {
            const wrap = document.createElement('span');
            wrap.className = 'ncm-shard-thumb-wrap';
            wrap.style.cssText = 'position:relative; display:inline-block; line-height:0; overflow:visible; vertical-align:middle;';
            thumb.parentNode.insertBefore(wrap, thumb);
            wrap.appendChild(thumb);
            const tag = document.createElement('div');
            tag.className = 'ncm-shard-img-tag ncm-terminal-img-tag';
            tag.innerHTML = '<i class="fas fa-terminal"></i>';
            tag.title = 'Terminal';
            wrap.appendChild(tag);
          }
          const interceptClick = (ev) => {
            if (ev.button !== 0 || ev.ctrlKey || ev.metaKey) return;
            ev.stopImmediatePropagation();
            ev.preventDefault();
            game.nightcity?.openTerminal(item);
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

    const isTerminal = !!item.getFlag(MODULE_ID, 'isTerminal');

    // Converted items: the two things you do most stay on top, everything else sits behind ONE
    // "Terminal options ▸" / "Shard options ▸" entry that opens NCM's own grouped menu (ACCESS · ITEM ·
    // Remove) beside it — Foundry v12's directory menu has no submenus (2026-10-29, dev-picked "Top 2 + one
    // more ▸"; first named "Night City", renamed the same day as too vague).
    if (isTerminal || isShard) {
      if (isTerminal) addOption('Open Terminal', 'fas fa-terminal', '#ff3355', () => game.nightcity?.openTerminal(item));
      else addOption(`Open ${T('one')}`, 'fas fa-hard-drive', '#00D4E6', () => game.nightcity?.openDataShard(item));
      if (isGM()) addOption(isTerminal ? 'Configure Terminal' : `Configure ${T('short')}`, 'fas fa-sliders', isTerminal ? '#ff3355' : '#00D4E6', () => this._configure(item));
      const entries = this._nightCityEntries(item, resolveOperator());
      if (entries.length) {
        const li = document.createElement('li');
        li.className = 'context-item ncm-ctx-more';
        li.innerHTML = `<i class="fas fa-ellipsis" style="color:#19f3f7;margin-right:6px;"></i> ${isTerminal ? 'Terminal' : T('short')} options<span class="ncm-ctx-more__arrow">▸</span>`;
        li.style.cssText = 'cursor:pointer;padding:4px 8px;white-space:nowrap;';
        let rect = null;
        li.addEventListener('pointerdown', () => { rect = li.getBoundingClientRect(); });
        li.addEventListener('click', (ev) => {
          ev.stopPropagation();
          menu.remove();
          document.querySelector('.context-overlay')?.remove();
          this._showContextMenu(ShardSheetOverride._subMenuAt(rect, ev), entries, { title: item.name, icon: isTerminal ? 'fas fa-terminal' : 'fas fa-microchip' });
        });
        li.addEventListener('mouseenter', () => { li.style.background = 'rgba(255,255,255,0.06)'; });
        li.addEventListener('mouseleave', () => { li.style.background = ''; });
        ol.appendChild(li);
      }
    } else if (isGM()) {
      addOption(`Convert to ${T('one')}`, 'fas fa-microchip', '#00D4E6', () => this._launchConversionFlow(item));
      addOption('Convert to Terminal', 'fas fa-terminal', '#ff3355', () => this._convertToTerminal(item));
      addOption('Malware Workshop', 'fas fa-biohazard', '#ff3355', () => game.nightcity?.openMalwareWorkshop?.());
    }
  }

  /** Open the config sheet for a terminal or a shard. */
  async _configure(item) {
    if (item.getFlag(MODULE_ID, 'isTerminal')) {
      const { TerminalConfigApp } = await import('../ui/Terminal/TerminalConfigApp.js');
      return new TerminalConfigApp({ item }).render(true);
    }
    const { ItemInboxConfig } = await import('../ui/ItemInbox/ItemInboxConfig.js');
    new ItemInboxConfig({ item }).render(true);
  }

  /**
   * The grouped "… options" menu for a converted item — ACCESS (place / hotbar / chat / journal link),
   * ITEM (rename, programs, the raw item sheet…), then Remove. Shared by the Items directory and the
   * actor sheets so the two never drift.
   */
  _nightCityEntries(item, actor = null) {
    const isTerminal = !!item.getFlag(MODULE_ID, 'isTerminal');
    const gm = isGM();
    const out = [...accessMenuEntries(item)];
    const itemSec = [];
    const sheet = () => { const sh = item.sheet; if (sh) { sh._ncmBypass = true; sh.render(true); } };
    if (isTerminal) {
      if (gm) itemSec.push({ label: 'Edit item sheet', icon: 'fas fa-file-alt', fn: sheet });
    } else {
      itemSec.push({ label: 'Program Deck', icon: 'fas fa-microchip', fn: () => game.nightcity?.openProgramDeck?.(item) });
      if (gm) {
        itemSec.push({ label: 'Build a program', icon: 'fas fa-biohazard', fn: () => game.nightcity?.openMalwareWorkshop?.({ target: { kind: 'shard', item } }) });
      } else if (canEditShard(item, actor).ok) {
        itemSec.push({ label: 'Encode more onto it', icon: 'fas fa-pen-nib', fn: () => game.nightcity?.openEncoder?.({ item, actor }) });
      }
      if (gm || ShardSheetOverride.canRename(item, actor)) itemSec.push({ label: 'Rename…', icon: 'fas fa-i-cursor', fn: () => this._renameShard(item) });
      if (gm) itemSec.push({ label: 'Edit item sheet', icon: 'fas fa-file-alt', fn: sheet });
    }
    if (itemSec.length) out.push({ head: 'Item' }, ...itemSec);
    const canRemove = gm || (!isTerminal && item.parent && ShardSheetOverride.canAuthor(actor));
    if (canRemove) {
      out.push({ sep: true }, isTerminal
        ? { label: 'Remove terminal data', icon: 'fas fa-rotate-left', bad: true, fn: () => this._confirmRemoveTerminal(item) }
        : { label: `Remove ${T('short')} data`, icon: 'fas fa-rotate-left', bad: true, fn: () => this._confirmUnconvert(item) });
    }
    return out;
  }

  /**
   * GM instant-convert an item to a Terminal (default config), then open the
   * config sheet to author it — mirrors the shard instant-convert affordance.
   * @param {Item} item
   */
  async _convertToTerminal(item) {
    const svc = game.nightcity?.terminalService;
    if (!svc) return;
    if (item.getFlag(MODULE_ID, 'isTerminal')) return ui.notifications.warn('Already a terminal.');
    const res = await svc.convertToTerminal(item);
    if (!res?.success) return ui.notifications.error(res?.error || 'Conversion failed.');
    ui.notifications.info(`"${item.name}" is now a Terminal.`);
    // Re-render the directory + any actor sheets so the terminal badge +
    // left-click intercept appear immediately (mirrors shard convert / remove).
    // Without this the item looked unchanged until a manual refresh.
    this._refreshItemViews(item);
    const { TerminalConfigApp } = await import('../ui/Terminal/TerminalConfigApp.js');
    new TerminalConfigApp({ item }).render(true);
  }

  /**
   * Rebuild the Items directory + any actor sheets showing this item so a
   * convert/remove reflects instantly. The entry DOM is recreated fresh, which
   * clears the `ncmProcessed` guard so the badge/intercept re-decorate.
   */
  _refreshItemViews(item) {
    setTimeout(() => {
      ui.items?.render();
      for (const sheet of Object.values(ui.windows)) {
        if (sheet.actor?.items?.has(item.id)) sheet.render(false);
      }
    }, 150);
  }

  /**
   * GM remove Terminal status (with optional journal delete).
   * @param {Item} item
   */
  async _confirmRemoveTerminal(item) {
    const cfg = game.nightcity?.terminalService?.getConfig(item) || {};
    const n = (cfg.accounts || []).length;
    const ok = await themedConfirm({
      title: 'Remove terminal data', yes: 'Remove', yesIcon: 'fas fa-rotate-left', no: 'Keep it', bad: true,
      content: dialogBodyHtml({
        tone: 'bad', icon: 'fas fa-terminal', img: item.img, title: cfg.terminalName || item.name,
        sub: [cfg.metadata?.org, cfg.metadata?.location].filter(Boolean).join(' · '), kind: 'Terminal',
        lead: `Turn **${item.name}** back into a plain item?`,
        goes: [`${n} account${n === 1 ? '' : 's'} and their logins`, 'The theme, boot screen and settings', 'Map pins for it'],
        stays: ['The item itself', 'The message journal (delete it by hand if you want it gone)'],
      }),
    });
    if (!ok) return;
    await game.nightcity?.terminalService?.removeTerminal(item);
    ui.notifications.info('Terminal data removed.');
    // Re-render the directory + any actor sheets so the terminal badge/intercept
    // are dropped (the entry DOM is rebuilt fresh, clearing ncmProcessed).
    setTimeout(() => {
      ui.items?.render();
      for (const sheet of Object.values(ui.windows)) {
        if (sheet.actor?.items?.has(item.id)) sheet.render(false);
      }
    }, 150);
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

      for (const item of actor.items) {
        const isShard = item.getFlag(MODULE_ID, 'isDataShard');
        // Find the item row — CPR uses data-item-id
        const row = root.querySelector(`[data-item-id="${item.id}"]`);
        if (!row) continue;

        if (isShard) {
          this._applyShardBadge(row, item, actor);
        } else {
          // Always attach; `_applyConvertButton` asks `canAuthor(actor)` for
          // whether this character actually gets a button.
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
  _applyShardBadge(row, item, actor = null) {
    // Don't double-badge on re-render
    if (row.querySelector('.ncm-shard-img-tag')) return;

    // ─── Corner tag on item image ───
    // Wrap the image in a tightly-bounded span so the badge anchors to the
    // image itself, not to the surrounding .item-image container (which
    // CPR sizes wider than the actual image and would push the badge off
    // to the right).
    const imgEl = row.querySelector('img.item-image, .item-image img, img, .item-icon');
    if (imgEl && imgEl.tagName === 'IMG' && !imgEl.parentElement?.classList.contains('ncm-shard-thumb-wrap')) {
      const wrap = document.createElement('span');
      wrap.className = 'ncm-shard-thumb-wrap';
      imgEl.parentNode.insertBefore(wrap, imgEl);
      wrap.appendChild(imgEl);

      const tag = document.createElement('div');
      tag.className = 'ncm-shard-img-tag';
      tag.innerHTML = '<i class="fas fa-microchip"></i>';
      tag.title = T('one');
      wrap.appendChild(tag);
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
      const entries = [
        { label: `Open ${T('one')}`, icon: 'fas fa-hard-drive', color: '#00D4E6', fn: () => game.nightcity?.openDataShard(item) },
      ];
      if (isGM()) entries.push({ label: `Configure ${T('short')}`, icon: 'fas fa-sliders', color: '#00D4E6', fn: () => this._configure(item) });
      const more = this._nightCityEntries(item, actor);
      if (more.length) entries.push({ label: `${T('short')} options`, icon: 'fas fa-ellipsis', color: '#19f3f7', more: true, fn: (pos) => this._showContextMenu(pos, more, { title: item.name, icon: 'fas fa-microchip' }) });
      this._showContextMenu(ev, entries);
    });
  }

  /**
   * Add a "Convert to Data Shard" button and right-click context menu
   * to a non-shard item's inventory row.
   * @param {HTMLElement} row
   * @param {Item} item
   * @param {Actor} actor
   */
  _applyConvertButton(row, item, actor) {
    // A player only gets the button on things that can be a blank (the
    // Encoder's `blanks.source` rule) — never on their pistol or their arm.
    const canConvert = isGM() || (ShardSheetOverride.canAuthor(actor) && ShardSheetOverride.isBlankFor(item));

    // ─── Inline convert button (best-effort — CPR may not have .item-controls) ───
    if (canConvert && !row.querySelector('.ncm-convert-shard-btn')) {
      const controls = row.querySelector('.item-controls, .item-control');
      if (controls) {
        const btn = document.createElement('a');
        btn.className = 'item-control ncm-convert-shard-btn';
        btn.title = isGM() ? `Convert to ${T('one')}` : `Encode to ${T('one')}`;
        btn.innerHTML = '<i class="fas fa-microchip"></i>';
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          this._launchConversionFlow(item, actor);
        });
        controls.prepend(btn);
      }
    }

    // ─── Right-click context menu (always attached) ───
    if (!row._ncmConvertCtx) {
      row._ncmConvertCtx = true;
      row.addEventListener('contextmenu', (ev) => {
        if (!isGM() && !(ShardSheetOverride.canAuthor(actor) && ShardSheetOverride.isBlankFor(item))) return;
        const entries = [
          { label: isGM() ? `Convert to ${T('one')}` : `Encode to ${T('one')}`, icon: 'fas fa-microchip', color: '#00D4E6', fn: () => this._launchConversionFlow(item, actor) },
        ];
        this._showContextMenu(ev, entries);
      });
    }
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
  _showContextMenu(ev, entries, { title = '', icon = '' } = {}) {
    ev.preventDefault?.();
    ev.stopPropagation?.();

    // Remove any existing NCM context menu
    document.querySelectorAll('.ncm-ctx-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'ncm-ctx-menu';
    if (title) {
      const t = document.createElement('div');
      t.className = 'ncm-ctx-menu__title';
      t.innerHTML = `<i class="${icon || 'fas fa-city'}"></i>`;
      t.append(document.createTextNode(title));
      menu.appendChild(t);
    }

    for (const entry of entries) {
      if (entry.sep) {
        const sep = document.createElement('div');
        sep.className = 'ncm-ctx-menu__sep';
        menu.appendChild(sep);
        continue;
      }
      if (entry.head) {
        const h = document.createElement('div');
        h.className = 'ncm-ctx-menu__head';
        h.textContent = entry.head;
        menu.appendChild(h);
        continue;
      }

      const item = document.createElement('div');
      item.className = `ncm-ctx-menu__item${entry.bad ? ' is-bad' : ''}`;
      item.innerHTML = `<i class="${entry.icon}"${entry.color ? ` style="color:${entry.color};"` : ''}></i> ${entry.label}${entry.more ? '<span style="margin-left:auto;padding-left:14px;opacity:.7">▸</span>' : ''}`;
      // Where a sub-menu opens: the row's box, measured on pointerdown — by 'click' the document-level
      // closer has already detached the menu and a detached row measures 0,0 (the top-left bug).
      let rect = null;
      item.addEventListener('pointerdown', () => { rect = item.getBoundingClientRect(); });
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.remove();
        entry.fn(entry.more ? ShardSheetOverride._subMenuAt(rect, e) : undefined);
      });
      menu.appendChild(item);
    }

    // Position at cursor
    menu.style.left = `${ev.clientX}px`;
    menu.style.top = `${ev.clientY}px`;
    document.body.appendChild(menu);
    const box = menu.getBoundingClientRect();
    if (box.right > window.innerWidth - 4) menu.style.left = `${Math.max(4, window.innerWidth - box.width - 4)}px`;
    if (box.bottom > window.innerHeight - 4) menu.style.top = `${Math.max(4, window.innerHeight - box.height - 4)}px`;

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
   * Launch shard conversion for an item.
   *
   * GMs convert instantly with the default config (mirroring the
   * Admin → Shards tab "Convert" button) and configure afterward via
   * the "Configure Shard" context option. Players get the Shard Encoder,
   * gated by `canEncode`.
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

    // Already a shard: a player who may rewrite it goes to the Encoder's
    // re-encode door; everyone else is told it is already one.
    if (item.getFlag(MODULE_ID, 'isDataShard')) {
      if (!isGM()) {
        const who = actor || resolveOperator();
        const verdict = canEditShard(item, who);
        if (verdict.ok) { game.nightcity?.openEncoder?.({ item, actor: who }); return; }
        if (verdict.locked) { ui.notifications.warn(`NCM | ${verdict.reason}`); return; }
      }
      ui.notifications.warn(`This item is already ${withArticle(T('one', 'lower'))}.`);
      return;
    }

    // ─── GM: instant convert with default config (no wizard) ───
    if (isGM()) {
      const result = await dataShardService.convertToDataShard(item);
      if (result?.success) {
        ui.notifications.info(`"${item.name}" converted to ${T('one', 'lower')}.`);
        setTimeout(() => {
          ui.items?.render();
          for (const sheet of Object.values(ui.windows)) {
            if (sheet.actor?.items?.has(item.id)) sheet.render(false);
          }
        }, 150);
      } else {
        ui.notifications.error(`Failed to convert to ${T('one', 'lower')}: ${result?.error || 'Unknown error'}`);
      }
      return;
    }

    // ─── Players: the Shard Encoder ───
    // It opens on the BLANK stage with this item seeded — deliberately NOT
    // `stage: 'program'`, which forced every item right-click into the Program
    // branch, so a player who wanted to forge a dossier landed on a page asking
    // which program to build. The Payload / Malware tiles switch branch.
    const verdict = canEncode(actor);
    if (!verdict.ok) {
      ui.notifications.warn(`NCM | ${verdict.reason}`);
      return;
    }
    if (!ShardSheetOverride.isBlankFor(item)) {
      ui.notifications.warn(`NCM | ${ShardSheetOverride.blankRefusal()}`);
      return;
    }
    game.nightcity?.openEncoder?.({ item, actor });
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

    const cfg = dataShardService.getConfig?.(item) || {};
    const confirmed = await themedConfirm({
      title: `Remove ${T('short', 'lower')} data`, yes: 'Remove', yesIcon: 'fas fa-rotate-left', no: 'Keep it', bad: true,
      content: dialogBodyHtml({
        tone: 'bad', icon: 'fas fa-microchip', img: item.img, title: cfg.shardName || item.name,
        sub: item.parent?.name ? `carried by ${item.parent.name}` : '', kind: T('short'),
        lead: `Strip all ${T('short', 'lower')} data from **${item.name}**? This can't be undone.`,
        goes: [`Every file on the ${T('short', 'lower')} (its journal)`, 'Locks, ICE and the boot screen', 'Integrity and anyone\'s hacking progress'],
        stays: ['The item itself', `The name and picture it had before it became ${withArticle(T('short', 'lower'))}`],
      }),
    });

    if (confirmed) {
      try {
        let success = false;

        if (isGM()) {
          const result = await dataShardService.removeDataShard(item);
          success = result?.success !== false;
          if (!success) throw new Error(result?.error || 'Failed');
        } else {
          // Player: relay through GM via socket
          success = await this._requestPlayerUnconvert(item);
          if (!success) throw new Error('Request denied or timed out');
        }

        ui.notifications.info(`${T('short')} data removed from "${item.name}"`);
        setTimeout(() => {
          ui.items?.render();
          for (const sheet of Object.values(ui.windows)) {
            if (sheet.actor?.items?.has(item.id)) sheet.render(false);
          }
        }, 150);
      } catch (err) {
        ui.notifications.error(`Failed to remove ${T('short', 'lower')} data: ${err.message}`);
      }
    }
  }

  /**
   * Request the GM's client to remove shard data via socket relay.
   * @param {Item} item
   * @returns {Promise<boolean>}
   */
  _requestPlayerUnconvert(item) {
    return new Promise((resolve) => {
      const socketManager = game.nightcity?.socketManager;
      if (!socketManager) return resolve(false);

      const requestId = foundry.utils.randomID(8);
      const actorId = item.actor?.id;
      if (!actorId) return resolve(false);

      socketManager.register(SOCKET_OPS.SHARD_UNCONVERT_RESULT, (data) => {
        if (data.requestId !== requestId) return;
        resolve(data.success);
      });

      socketManager.emit(SOCKET_OPS.SHARD_UNCONVERT_REQUEST, {
        requestId,
        itemId: item.id,
        actorId,
      });

      setTimeout(() => resolve(false), 10000);
    });
  }
}
