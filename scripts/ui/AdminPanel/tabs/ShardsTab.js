/**
 * ShardsTab — Admin → Shards (redesign 2026-10-27).
 * @file scripts/ui/AdminPanel/tabs/ShardsTab.js
 * @module night-city-messenger
 *
 * Built from dev/mockups/admin-shards-redesign-mock.html: a header (+ New / ⋯
 * menus), the Player Authoring strip, a toolbar (search · group · holder · sort ·
 * Select), filter chips with counts, then ONE scrolling list (grouped under
 * sticky, foldable headers) beside the selected shard's detail (security as a
 * chain of layers, every entry with eddies / encryption / damage, integrity in
 * one block).
 *
 * New buttons ride the generic `tabAct` action (data-owner="shards" data-op=…)
 * and land in onAct(). The shard actions that already had static delegators on
 * AdminPanelApp (openShardItem, configureShardItem, toggleShardLayer,
 * damageShard…) keep them — the sims and the keyboard shortcuts read those names.
 *
 * Cross-parent dependencies:
 *   - this.app.constructor._findItem(id)   — static item lookup
 *   - this.app._animationActive            — BaseApplication debounce guard
 *   - this.app._getRelativeTime(ts)        — used by logActivity timestamps
 */

import { showAccessMenu } from '../../../integrations/AccessPoints.js';
import { MODULE_ID } from '../../../utils/constants.js';
import { log } from '../../../utils/helpers.js';
import { BaseTab } from '../BaseTab.js';
import { entryLevel, applyLoss, effectiveHit } from '../../content/IntegrityModel.js';
import { cartridgeView, peekLights, bayColor, stateOf, entryState, integrityView, agoLabel, entryHue, DETAIL_SECTIONS, bayShut, pathSummary, integSummary, entsSummary } from './shardsModel.js';
import { getContentTypeInfo } from '../../content/ContentRenderers.js';
import {
  SHARD_EDIT_MODES, resolveShardEditing, resolveEncoderConfig, gateSummary,
} from '../../content/EncoderModel.js';
import { adminDialog, adminConfirm } from '../../../utils/adminTheme.js';
import { showNamePicker, documentEntries } from '../../../utils/namePicker.js';

/**
 * The Filter menu, in order. Multi-select (2026-10-28 toolbar tidy): `state` picks
 * OR together ("Locked or Bricked"), `has` picks AND together ("damaged AND holding
 * eddies"), and the two kinds AND with each other. `test` runs over a gathered row.
 */
export const SHARD_FILTERS = Object.freeze([
  { key: 'locked',   kind: 'state', label: 'Locked',          icon: 'fa-lock',             test: (s) => s.status === 'locked' || s.status === 'blackice' },
  { key: 'ice',      kind: 'state', label: 'Black ICE',       icon: 'fa-skull',            test: (s) => s.status === 'blackice' },
  { key: 'breached', kind: 'state', label: 'Breached',        icon: 'fa-lock-open',        test: (s) => s.status === 'breached' },
  { key: 'open',     kind: 'state', label: 'Open (no lock)',  icon: 'fa-unlock',           test: (s) => s.status === 'open' },
  { key: 'bricked',  kind: 'state', label: 'Bricked',         icon: 'fa-skull-crossbones', test: (s) => s.status === 'destroyed' },
  { key: 'eb',       kind: 'has',   label: 'Unclaimed eddies', icon: 'fa-coins',           test: (s) => s.unclaimedEddies > 0 },
  { key: 'dmg',      kind: 'has',   label: 'Damaged',         icon: 'fa-bolt',             test: (s) => s.isDamaged },
  { key: 'made',     kind: 'has',   label: 'Player-made',     icon: 'fa-user-pen',         test: (s) => !!s.makerName },
]);

/** Group-by modes (the View menu's first section). 'owner' = who holds it. */
export const SHARD_GROUP_MODES = Object.freeze({
  owner: 'Holder', maker: 'Maker', preset: 'Preset', folder: 'Folder', status: 'State', none: 'No groups',
});
export const SHARD_SORTS = Object.freeze({ name: 'Name', status: 'State', accessed: 'Last opened', integ: 'Integrity, lowest' });
export const SHARD_HOLDERS = Object.freeze({ all: 'Anyone', world: 'World items', actors: 'Characters' });
const GROUP_ICONS = { owner: 'fa-user', maker: 'fa-user-pen', preset: 'fa-palette', folder: 'fa-folder', status: 'fa-lock', none: 'fa-list' };
const HOLDER_ICONS = { all: 'fa-users', world: 'fa-globe', actors: 'fa-user' };
const SORT_ICONS = { name: 'fa-arrow-down-a-z', status: 'fa-lock', accessed: 'fa-clock', integ: 'fa-battery-half' };

/** Preset → colour token key (CSS maps `data-c` to a --ncm-* token). */
const PRESET_COLOR = {
  'corporate-dossier': 'red', 'military-intel': 'green', 'fixer-dead-drop': 'gold', 'street-shard': 'gold',
  'black-market': 'purple', 'personal-memory': 'muted', 'media-leak': 'cyan', 'netwatch-evidence': 'cyan', blank: 'muted',
};
const STATUS_LABELS = { locked: 'Locked', blackice: 'Black ICE', breached: 'Breached', open: 'Open', destroyed: 'Bricked' };
// A status tag says what state the shard is in: shut = red, opened = green, open = plain.
const STATUS_TONE = { locked: 'is-secret', blackice: 'is-bad', breached: 'is-good', open: 'is-plain', destroyed: 'is-bad' };
/** Filter-chip tones: what a non-zero count MEANS (none = neutral). */
const CHIP_TONE = { ice: 'bad', bricked: 'bad', dmg: 'attn', eb: 'money' };
const STATUS_ICONS = { locked: 'fas fa-lock', blackice: 'fas fa-skull', breached: 'fas fa-lock-open', open: 'fas fa-unlock', destroyed: 'fas fa-skull-crossbones' };
const LAYER_ORDER = ['network', 'keyitem', 'login', 'encryption'];
const BLANK_FACT = { gear: 'Blanks: gear', registered: 'Blanks: listed items only', any: 'Blanks: any carried item' };
const PRICE_FACT = { off: 'No prices', propose: 'Prices: you approve', free: 'Prices: the player sets them', formula: 'Prices: by formula' };

export class ShardsTab extends BaseTab {

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  /** @type {Array<object>} In-memory activity log for this session (AdminPanelApp writes it) */
  _activityLog = [];
  /** @type {boolean} Bulk select mode active */
  _selectMode = false;
  /** @type {Set<string>} Picked shard item IDs (bulk mode) */
  _selectedIds = new Set();
  /** @type {string|null} The shard open in the detail pane */
  _selId = null;
  /** @type {Set<string>} Bays the GM folded this session (default: every bay but the first is folded — shardsModel.bayShut) */
  _collapsedGroups = new Set();
  /** @type {Set<string>} Bays the GM unfolded this session (overrides the default fold) */
  _openedGroups = new Set();
  /** @type {Map<string, boolean>} Each bay's fold as last drawn (the toggle's fallback when the bay isn't on screen) */
  _bayShutNow = new Map();
  /** The selection the bays last opened a bay for (a new pick opens its bay once; the GM's fold wins after). */
  _baySelSeen = undefined;
  /** @type {Set<string>} Detail sections folded this session (DETAIL_SECTIONS keys) — one choice for every shard; all start folded */
  _secShut = new Set(DETAIL_SECTIONS);
  /** @type {string} Search query */
  _search = '';
  /** @type {string} Sort: 'name' | 'status' | 'accessed' */
  _sort = 'name';
  /** @type {string} Group mode — a SHARD_GROUP_MODES key */
  _groupMode = 'owner';
  /** @type {Set<string>} Filter menu picks — SHARD_FILTERS keys (empty = everything) */
  _filters = new Set();
  /** @type {null|'view'|'filter'} Which toolbar popover is open (body-mounted portal) */
  _pop = null;
  /** @type {Function|null} Outside-click / Esc closer for the open popover */
  _popListener = null;
  /** @type {string} Holder filter: 'all' | 'world' | 'actors' */
  _ownerFilter = 'all';
  /** @type {Function|null} Lazy-init debounced search input handler */
  _searchHandler = null;
  /** @type {Function|null} Document click handler that closes open menus */
  _menuCloser = null;

  get key() { return 'shards'; }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  prepareContext() {
    const all = this._gatherData();
    const shardSummary = {
      total: all.length,
      locked: all.filter(s => s.status === 'locked' || s.status === 'blackice').length,
      breached: all.filter(s => s.status === 'breached').length,
      destroyed: all.filter(s => s.status === 'destroyed').length,
      open: all.filter(s => s.status === 'open').length,
      totalEddies: all.reduce((sum, s) => sum + (s.totalEddies || 0), 0),
      claimedEddies: all.reduce((sum, s) => sum + (s.claimedEddies || 0), 0),
      unclaimedEddies: all.reduce((sum, s) => sum + (s.unclaimedEddies || 0), 0),
      totalEntries: all.reduce((sum, s) => sum + (s.entryCount || 0), 0),
    };

    // `shards` (every shard, unfiltered) + `shardSummary` are read OUTSIDE this tab
    // (the Overview tiles, the HUD strip, the header stats line) — keep both.
    // Everything this tab's template reads lives under `shards2`.
    if (this.app?._activeTab !== 'shards') return { shards: all, shardSummary, shards2: null };

    const visible = this._applyFilters(all);
    // The selected shard: the remembered one if it is still listed, else the first row
    // in display order (groups sort world-first, so that is not simply visible[0]).
    if (!visible.some(s => s.itemId === this._selId)) {
      const first = this._buildGroups(visible).find(g => g.rows.length)?.rows[0];
      this._selId = first?.itemId ?? visible[0]?.itemId ?? null;
    }
    const groups = this._buildGroups(visible);
    const sel = visible.find(s => s.itemId === this._selId) || null;

    const presets = (this.dataShardService?.getAllPresets?.() ?? [])
      .filter(p => p.key !== 'blank')
      .map(p => ({ key: p.key, label: p.label, icon: p.icon || 'fas fa-microchip', c: PRESET_COLOR[p.key] || 'cyan' }));

    return {
      shards: all,
      shardSummary,
      shards2: {
        auth: this._authContext(all),
        presets,
        search: this._search,
        bulk: this._selectMode,
        pickedCount: this._selectedIds.size,
        ...this._toolbarContext(all, visible),
        groups,
        hasShards: all.length > 0,
        noMatch: all.length > 0 && visible.length === 0,
        noMatchWhy: this._hiddenBy().join(', '),
        detail: sel ? this._detailContext(sel) : null,
        isPopout: this.isPopout,
      },
    };
  }

  onRender(context, options) {
    const root = this.element?.querySelector('.ncm-sh2');
    if (!root) return;

    const searchInput = root.querySelector('.ncm-sh2-search input');
    if (searchInput) {
      if (this._search) {
        searchInput.value = this._search;
        searchInput.focus();
        const len = this._search.length;
        searchInput.setSelectionRange(len, len);
      }
      const handler = this._searchHandler || (this._searchHandler =
        foundry.utils.debounce((e) => { this._search = e.target.value; this.render(); }, 300));
      searchInput.removeEventListener('input', handler);
      searchInput.addEventListener('input', handler);
    }

    // The View / Filter popovers live on document.body while open (a portal — the
    // panel's overflow and zoom never clip them). Mounted fresh every render.
    this._mountPop(root);

    // Menus are DOM-only (opening one must not re-render). One document listener
    // closes them on an outside click — and after a menu item was picked.
    if (!this._menuCloser) {
      this._menuCloser = (ev) => {
        const el = this.element;
        if (!el) return;
        const inMenu = ev.target.closest?.('.ncm-sh2-menu');
        const opener = ev.target.closest?.('[data-op="menu"]');
        if (opener && el.contains(opener)) return;
        if (inMenu && el.contains(inMenu) && !ev.target.closest('.ncm-sh2-menu__it')) return;
        el.querySelectorAll('.ncm-sh2-menu.is-open').forEach(m => m.classList.remove('is-open'));
      };
      document.addEventListener('click', this._menuCloser, true);
    }

    // Scroll memo: every click re-renders the tab, which rebuilt both panes at the top
    // (tester: "clicking a shard resets the scroll"). The list keeps its place always;
    // the detail keeps its place while the same shard stays open.
    this._scrollMem ??= {};
    const selId = root.querySelector('.ncm-sh2-slot.is-sel')?.dataset?.itemId || '';
    for (const [key, sel] of [['list', '.ncm-sh2-list'], ['det', '.ncm-sh2-det'], ['ents', '.ncm-sh2-ents'], ['hist', '.ncm-sh2-ighist']]) {
      const box = root.querySelector(sel);
      if (!box) continue;
      const mem = this._scrollMem[key];
      if (mem && (key === 'list' || mem.sel === selId)) box.scrollTop = mem.top;
      box.addEventListener('scroll', () => { this._scrollMem[key] = { top: box.scrollTop, sel: selId }; }, { passive: true });
    }
    // Item art that fails to load falls back to the chip glyph.
    for (const img of root.querySelectorAll('.ncm-sh2-img img')) {
      const fail = () => { img.parentElement?.classList.add('is-glyph'); img.remove(); };
      if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) fail();
      else img.addEventListener('error', fail, { once: true });
    }
    // Each bay scrolls on its own past ~6 cartridges — keep its place too.
    this._bayScroll ??= {};
    for (const bay of root.querySelectorAll('.ncm-sh2-bay[data-bay]')) {
      const k = bay.dataset.bay;
      if (this._bayScroll[k]) bay.scrollTop = this._bayScroll[k];
      bay.addEventListener('scroll', () => { this._bayScroll[k] = bay.scrollTop; }, { passive: true });
    }
    // The bay headers and the detail section bands are role="button" divs (a band holds
    // its own buttons, so it cannot BE a <button>): Enter / Space work them like a click.
    for (const el of root.querySelectorAll('.ncm-sh2-grp[role="button"], .ncm-sh2-sec__k[role="button"]')) {
      el.addEventListener('keydown', (ev) => {
        if (ev.target !== el || (ev.key !== 'Enter' && ev.key !== ' ')) return;
        ev.preventDefault();
        el.click();
      });
    }
    this._replayEject(root);
    // A selection made from somewhere else (openTo, a filter) still lands in view.
    if (!this._scrollMem.list) root.querySelector('.ncm-sh2-slot.is-sel')?.scrollIntoView?.({ block: 'nearest' });
  }

  onClose() {
    if (this._menuCloser) document.removeEventListener('click', this._menuCloser, true);
    this._menuCloser = null;
    this._pop = null;
    this._dropPop();
  }

  /** Open on one shard (item id or uuid) — openAdminTab({ select }) / Pop out's data-select. */
  openTo(select) {
    if (!select) return;
    let item = null;
    if (String(select).includes('.')) {
      try { item = fromUuidSync(select); } catch { item = null; }
    }
    if (!item) item = this.app.constructor._findItem?.(select) ?? null;
    if (!item) return;
    this._selId = item.id;
    this._filters.clear();
    this._search = '';
    this._ownerFilter = 'all';
    this._selectMode = false;
    this._selectedIds.clear();
    this._collapsedGroups.clear();
    this._openedGroups.clear();
    this._baySelSeen = undefined;
  }

  // ═══════════════════════════════════════════════════════════
  //  Generic tab actions (data-action="tabAct" data-owner="shards")
  // ═══════════════════════════════════════════════════════════

  onAct(op, event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    switch (op) {
      case 'access': { const it = this.app.constructor._findItem(itemId); return it && showAccessMenu(it, target); }
      case 'row':
        if (this._selectMode) {
          if (!itemId) return;
          this._selectedIds.has(itemId) ? this._selectedIds.delete(itemId) : this._selectedIds.add(itemId);
        } else {
          if (!itemId || itemId === this._selId) return;
          // The cartridge ejects toward the detail: swap the class on the LIVE node now
          // (the transition starts at once), then re-render for the new detail —
          // onRender replays the swap on the new nodes from the remembered start.
          this._eject = { from: this._selId, to: itemId };
          this._selId = itemId;
          this._ejectLive(this._eject);
        }
        return this.render();
      case 'group': {   // a bay header: fold / unfold DOM-only (grid-rows animates the height)
        const key = target.closest('[data-group-key]')?.dataset.groupKey;
        if (!key) return;
        const bay = target.closest('.ncm-sh2-bayw');
        // The bay's CURRENT state is what's on screen (a default fold has no entry in either set).
        const shut = bay ? !bay.classList.contains('is-shut') : !this._bayShutNow.get(key);
        if (shut) { this._collapsedGroups.add(key); this._openedGroups.delete(key); }
        else { this._openedGroups.add(key); this._collapsedGroups.delete(key); }
        if (!bay) return this.render();
        bay.classList.toggle('is-shut', shut);
        const hd = bay.querySelector('.ncm-sh2-grp');
        hd?.setAttribute('aria-expanded', shut ? 'false' : 'true');
        const fh = bay.querySelector('.ncm-sh2-grp__fh');
        if (fh) fh.textContent = shut ? 'unfold' : 'fold';
        return;
      }
      case 'sec': {   // a detail section band: fold / unfold DOM-only, remembered for the session
        const sec = target.closest('[data-sec]');
        const key = sec?.dataset.sec;
        if (!DETAIL_SECTIONS.includes(key)) return;
        const shut = !this._secShut.has(key);
        shut ? this._secShut.add(key) : this._secShut.delete(key);
        const box = sec.closest('.ncm-sh2-sec');
        if (!box) return this.render();
        box.classList.toggle('is-shut', shut);
        sec.setAttribute('aria-expanded', shut ? 'false' : 'true');
        return;
      }
      case 'igOn':
      case 'igOff':
        return this._setIntegrityOn(itemId, op === 'igOn');
      case 'igRepair': return this._integrityOp(itemId, 'repair');
      case 'igBrick': return this._integrityOp(itemId, 'brick');
      case 'igSalvage': return this._integrityOp(itemId, 'salvage');
      case 'igStep': {   // the Damage amount's − / + (DOM-only)
        const input = target.closest('.ncm-sh2-ig')?.querySelector('[data-ig-amount]');
        if (!input) return;
        const d = parseInt(target.dataset.step) || 0;
        input.value = String(Math.max(1, Math.min(1000, (parseInt(input.value) || 0) + d)));
        return;
      }
      case 'filter': {   // toggle one filter (a pill's ✕; the menu rows use _pickPop)
        const f = target.closest('[data-filter]')?.dataset.filter;
        if (!SHARD_FILTERS.some(x => x.key === f)) return;
        this._filters.has(f) ? this._filters.delete(f) : this._filters.add(f);
        return this.render();
      }
      case 'holderAll':  // the "Held by" pill's ✕
        this._ownerFilter = 'all';
        return this.render();
      case 'clearFilters':
        this._filters.clear();
        this._ownerFilter = 'all';
        return this.render();
      case 'view':
        return this._togglePop('view');
      case 'filters':
        return this._togglePop('filter');
      case 'bulk':
        this._selectMode = !this._selectMode;
        this._selectedIds.clear();
        return this.render();
      case 'pickAll':
        for (const s of this._applyFilters(this._gatherData())) this._selectedIds.add(s.itemId);
        return this.render();
      case 'pickNone':
        this._selectedIds.clear();
        return this.render();
      case 'menu': return this._toggleMenu(target);
      case 'clearSearch':
        this._search = '';
        this._filters.clear();
        this._ownerFilter = 'all';
        return this.render();
      case 'clearQuery':
        this._search = '';
        return this.render();
      case 'bulkUnconvert': return this.onBulkUnconvertSelected();
      case 'exportOne': return this._exportShards(itemId ? [itemId] : []);
      case 'import': return this.onImportShards();
      case 'authOn': return this.onAuthoringOn();
      default:
        log.warn(`ShardsTab: unknown op "${op}"`);
    }
  }

  _toggleMenu(target) {
    const key = target.dataset.menu;
    const root = this.element?.querySelector('.ncm-sh2');
    const menu = root?.querySelector(`.ncm-sh2-menu[data-menu-id="${key}"]`);
    if (!menu) return;
    const willOpen = !menu.classList.contains('is-open');
    root.querySelectorAll('.ncm-sh2-menu.is-open').forEach(m => m.classList.remove('is-open'));
    if (willOpen) { this._closePop(); menu.classList.add('is-open'); }
  }

  /** Swap the selected cartridge on the live DOM (no wait for the re-render). */
  _ejectLive({ from, to }) {
    const root = this.element?.querySelector('.ncm-sh2');
    if (!root) return;
    root.querySelectorAll('.ncm-sh2-slot.is-sel').forEach(n => n.classList.remove('is-sel'));
    root.querySelector(`.ncm-sh2-slot[data-item-id="${CSS.escape(to)}"]`)?.classList.add('is-sel');
  }

  /** After a selection re-render: start the new nodes at the old selection, then let them ease. */
  _replayEject(root) {
    const ej = this._eject;
    this._eject = null;
    if (!ej) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.querySelector('.ncm-sh2-det__root')?.classList.add('is-fresh');
    if (reduce) return;
    const slot = (id) => (id ? root.querySelector(`.ncm-sh2-slot[data-item-id="${CSS.escape(id)}"]`) : null);
    const to = slot(ej.to), from = slot(ej.from);
    if (!to) return;
    const all = [to, from].filter(Boolean);
    all.forEach(n => n.classList.add('no-anim'));
    to.classList.remove('is-sel');
    from?.classList.add('is-sel');
    void to.offsetWidth;   // commit the start state
    all.forEach(n => n.classList.remove('no-anim'));
    from?.classList.remove('is-sel');
    to.classList.add('is-sel');
  }

  /** Integrity on / off for one shard (Configure → Systems writes the same flag). */
  async _setIntegrityOn(itemId, on) {
    const item = itemId ? this.app.constructor._findItem(itemId) : null;
    if (!item) return;
    const res = await this.dataShardService?.updateConfig?.(item, { integrity: { enabled: on } });
    if (res && !res.success) ui.notifications.warn(`NCM | ${res.error || 'Could not change integrity'}`);
    this.render();
  }

  /** Repair (+repairPts) / Brick (to 0, after a confirm) / Salvage (bring a bricked shard back). */
  async _integrityOp(itemId, kind) {
    const item = itemId ? this.app.constructor._findItem(itemId) : null;
    const svc = this.dataShardService;
    if (!item || !svc) return;
    const cfg = svc.getIntegrityConfig?.(item);
    this.app._animationActive = true;
    try {
      if (kind === 'repair') {
        const res = await svc.repairIntegrity(item, cfg?.repairPts ?? 15);
        if (!res?.success) ui.notifications.warn(`NCM | Repair failed: ${res?.error || 'Unknown'}`);
      } else if (kind === 'brick') {
        this.app._animationActive = false;
        const ok = await adminConfirm({ title: 'Brick this shard', content: `<p>Take <strong>${item.name}</strong> to 0 integrity? Players will find it dead. Repair or Salvage brings it back.</p>` });
        if (!ok) return;
        this.app._animationActive = true;
        const res = await svc.setIntegrity(item, 0, { uncorrupt: false });
        if (!res?.success) ui.notifications.warn(`NCM | Brick failed: ${res?.error || 'Unknown'}`);
      } else if (kind === 'salvage') {
        const res = await svc.salvageShard(item, 'GM', true);
        if (res?.success) ui.notifications.info(`NCM | ${item.name} salvaged — back at ${res.newIntegrity ?? '?'}, its entries badly damaged.`);
        else ui.notifications.warn(`NCM | Salvage failed: ${res?.error || 'Unknown'}`);
      }
    } catch (err) {
      ui.notifications.error(`NCM | ${err.message}`);
    } finally {
      this.app._animationActive = false;
    }
    this.render();
  }

  // ═══════════════════════════════════════════════════════════
  //  Toolbar: the View menu (Group by · Held by · Sort) + the Filter menu
  // ═══════════════════════════════════════════════════════════
  // The template renders both popovers inside the tab; onRender moves the open one to
  // document.body (a portal, so the panel's overflow and zoom never clip it) and puts it
  // under its button. One live node per window — keyed by the app id, so a pop-out keeps
  // its own. An outside pointer-down or Esc closes it. A View pick closes the menu; a
  // Filter pick keeps it open so several can be ticked.

  _popKey() { return String(this.app?.id || 'ncm-admin'); }

  _dropPop() {
    if (typeof document === 'undefined') return;
    if (this._popListener) {
      document.removeEventListener('pointerdown', this._popListener, true);
      document.removeEventListener('keydown', this._popListener, true);
      this._popListener = null;
    }
    document.querySelectorAll?.(`.ncm-sh2-dd[data-pop-owner="${CSS.escape(this._popKey())}"]`)?.forEach((n) => n.remove());
  }

  _togglePop(kind) {
    this._pop = this._pop === kind ? null : kind;
    this.element?.querySelectorAll?.('.ncm-sh2-menu.is-open').forEach(m => m.classList.remove('is-open'));
    this.render();
  }

  _closePop() {
    const was = this._pop;
    this._pop = null;
    this._dropPop();
    if (!was) return;
    const btn = this.element?.querySelector?.(`[data-sh2-popbtn="${was}"]`);
    if (btn) { btn.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); }
  }

  /** A pick inside a popover: kind = group | holder | sort | filter | clear | done. */
  _pickPop(kind, value) {
    switch (kind) {
      case 'group': if (!SHARD_GROUP_MODES[value]) return; this._groupMode = value; this._collapsedGroups.clear(); this._openedGroups.clear(); this._baySelSeen = undefined; break;
      case 'holder': if (!SHARD_HOLDERS[value]) return; this._ownerFilter = value; break;
      case 'sort': if (!SHARD_SORTS[value]) return; this._sort = value; break;
      case 'filter':
        if (!SHARD_FILTERS.some(x => x.key === value)) return;
        this._filters.has(value) ? this._filters.delete(value) : this._filters.add(value);
        return this.render();             // stays open
      case 'clear': this._filters.clear(); return this.render();
      case 'done': break;
      default: return;
    }
    this._pop = null;
    this.render();
  }

  _mountPop(root) {
    this._dropPop();                      // last render's node (already on body) is stale
    const btn = this._pop && !this._selectMode ? root.querySelector(`[data-sh2-popbtn="${this._pop}"]`) : null;
    const pop = btn ? root.querySelector(`[data-sh2-pop="${this._pop}"]`) : null;
    root.querySelectorAll('[data-sh2-pop]').forEach((n) => { if (n !== pop) n.remove(); });
    if (!pop) { this._pop = null; return; }
    pop.dataset.popOwner = this._popKey();
    pop.classList.add('ncm-app', 'is-portal');
    pop.dataset.ncmAdminTheme = this.app.element?.closest?.('[data-ncm-admin-theme]')?.dataset?.ncmAdminTheme
      || this.app.element?.dataset?.ncmAdminTheme || 'clean-dark';
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth || 260;
    pop.style.top = `${Math.round(r.bottom + 4)}px`;
    pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8)))}px`;
    pop.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      this._pickPop(b.dataset.pick, b.dataset.value);
    }));
    this._popListener = (ev) => {
      if (ev.type === 'keydown') { if (ev.key === 'Escape') { ev.stopPropagation(); this._closePop(); } return; }
      if (ev.target?.closest?.('.ncm-sh2-dd, [data-sh2-popbtn]')) return;
      this._closePop();
    };
    document.addEventListener('pointerdown', this._popListener, true);
    document.addEventListener('keydown', this._popListener, true);
  }

  /** The toolbar's view-model: View summary + sections, Filter sections + active pills. */
  _toolbarContext(all, visible) {
    const g = SHARD_GROUP_MODES[this._groupMode] ? this._groupMode : 'owner';
    const viewParts = [g === 'none' ? 'No groups' : `By ${SHARD_GROUP_MODES[g].toLowerCase()}`, SHARD_SORTS[this._sort] || 'Name'];
    const opt = (kind, map, icons, cur) => Object.entries(map).map(([value, label]) => ({ kind, value, label, icon: icons[value], on: value === cur }));
    const base = this._baseFilter(all);
    const fopt = (kind) => SHARD_FILTERS.filter(f => f.kind === kind).map(f => {
      const n = base.filter(f.test).length;
      return { kind: 'filter', value: f.key, label: f.label, icon: f.icon, n, on: this._filters.has(f.key), tone: (n > 0 && CHIP_TONE[f.key]) || '' };
    });
    const pills = SHARD_FILTERS.filter(f => this._filters.has(f.key))
      .map(f => ({ op: 'filter', value: f.key, label: f.label, icon: f.icon, tone: CHIP_TONE[f.key] || '' }));
    if (this._ownerFilter !== 'all') pills.unshift({ op: 'holderAll', value: '', label: `Held by: ${SHARD_HOLDERS[this._ownerFilter]}`, icon: HOLDER_ICONS[this._ownerFilter], tone: '' });
    return {
      viewLabel: viewParts.join(' · '),
      viewOpen: this._pop === 'view' && !this._selectMode,
      viewSections: [
        { label: 'Group by', hint: 'headings in the list', options: opt('group', SHARD_GROUP_MODES, GROUP_ICONS, g) },
        { label: 'Held by', hint: 'whose shards to list', options: opt('holder', SHARD_HOLDERS, HOLDER_ICONS, this._ownerFilter) },
        { label: 'Sort', hint: 'inside each heading', options: opt('sort', SHARD_SORTS, SORT_ICONS, this._sort) },
      ],
      filterOpen: this._pop === 'filter' && !this._selectMode,
      filterCount: this._filters.size,
      filterSections: [
        { label: 'State', hint: 'any of these', options: fopt('state') },
        { label: 'Has', hint: 'all of these', options: fopt('has') },
      ],
      pills,
      shownCount: visible.length,
      totalCount: all.length,
    };
  }

  /** What is narrowing the list, in words — the no-match state names it. */
  _hiddenBy() {
    const why = [];
    if (this._search) why.push(`the search “${this._search}”`);
    if (this._ownerFilter !== 'all') why.push(`Held by: ${SHARD_HOLDERS[this._ownerFilter]}`);
    for (const f of SHARD_FILTERS) if (this._filters.has(f.key)) why.push(f.label);
    return why;
  }

  // ═══════════════════════════════════════════════════════════
  //  Activity Log — called from parent's shard EventBus subscriptions
  // ═══════════════════════════════════════════════════════════

  /**
   * Record a shard event in the session activity log. The redesign no longer
   * renders the session strip (the Security tab's log keeps the history), but
   * AdminPanelApp still calls this from its shard subscriptions.
   */
  logActivity(type, icon, data, text) {
    const actor = data.actorId ? game.actors?.get(data.actorId) : null;
    const item = data.itemId ? game.items?.get(data.itemId) : null;
    const actorName = actor?.name || (data.actorId === 'gm-override' ? 'GM' : 'Unknown');
    const shardName = item?.name || 'Unknown Shard';
    this._activityLog.unshift({
      type, icon,
      text: `<span class="ncm-activity-actor">${actorName}</span> ${text} — <span class="ncm-activity-shard">${shardName}</span>`,
      time: this.app._getRelativeTime?.(Date.now()),
      timestamp: Date.now(),
    });
    if (this._activityLog.length > 20) this._activityLog.length = 20;
  }

  // ═══════════════════════════════════════════════════════════
  //  Data gathering
  // ═══════════════════════════════════════════════════════════

  /** Every Item flagged as a data shard (world + actor-owned). */
  _getAllDataShards() {
    const shards = [];
    for (const item of game.items ?? []) {
      if (item.getFlag(MODULE_ID, 'isDataShard') === true) shards.push(item);
    }
    for (const actor of game.actors ?? []) {
      for (const item of actor.items ?? []) {
        if (item.getFlag(MODULE_ID, 'isDataShard') === true) shards.push(item);
      }
    }
    return shards;
  }

  /** One row per shard — unfiltered. */
  _gatherData() {
    const shards = [];
    try {
      const svc = this.dataShardService;
      for (const item of this._getAllDataShards()) {
        const config = svc?.getConfig?.(item) ?? item.getFlag(MODULE_ID, 'config') ?? {};
        const state = svc?.getState?.(item) ?? item.getFlag(MODULE_ID, 'state') ?? {};
        const integrity = svc?.checkIntegrity?.(item) ?? { enabled: false, percentage: 100, tier: 'clean' };

        const presetKey = config.preset || 'blank';
        const preset = svc?.getPreset?.(presetKey);

        let status = 'locked';
        if (state.destroyed || integrity.isBricked) status = 'destroyed';
        else if (state.decrypted) status = 'breached';
        else if (config.encryptionType === 'BLACK_ICE' || config.encryptionType === 'RED_ICE') status = 'blackice';
        else if (!config.encrypted && !config.requiresLogin && !config.requiresKeyItem && !(config.network?.required ?? config.requiresNetwork)) status = 'open';

        // A shard a PLAYER forged is flagged at encode time (ShardEncoderApp's
        // _shardConfig). The GM needs to know a dossier is a fake BEFORE the NPC
        // it accuses does — so it is tagged here and filed under its maker's
        // folder in the journal tree.
        const made = config.playerMade;
        const makerName = made?.actorName || '';
        const makerTag = made?.actorName
          ? { type: made.outcome === 'sloppy' ? 'gold' : 'purple', label: `Made by ${made.actorName}`, sloppy: made.outcome === 'sloppy' }
          : null;

        const editMode = resolveShardEditing(config);
        const hardening = integrity.cfg?.hardening || 0;

        // Holder — for grouping.
        let ownerKey = 'world', ownerName = 'World items', ownerIcon = 'fas fa-globe', ownerImg = null;
        if (item.parent && item.parent instanceof Actor) {
          ownerKey = `actor-${item.parent.id}`;
          ownerName = `${item.parent.name}’s gear`;
          ownerIcon = 'fas fa-user';
          ownerImg = item.parent.img || item.parent.prototypeToken?.texture?.src || null;
        } else if (item.compendium) {
          ownerKey = 'compendium'; ownerName = 'Compendium'; ownerIcon = 'fas fa-book';
        }
        // Folder — a world item's own folder; an embedded item has none, so its holder's.
        const folderName = item.folder?.name || item.parent?.folder?.name || '';

        // Entries + eddies.
        const journalId = item.getFlag(MODULE_ID, 'journalId');
        const journal = journalId ? game.journal?.get(journalId) : null;
        const entryCount = journal?.pages?.size ?? 0;
        let totalEddies = 0, claimedEddies = 0, unclaimedEddies = 0, corruptedCount = 0;
        if (journal) {
          for (const page of journal.pages) {
            const flags = page.flags?.[MODULE_ID];
            if (flags?.contentType === 'eddies' && flags?.contentData) {
              const amt = flags.contentData.amount ?? 0;
              totalEddies += amt;
              if (flags.contentData.claimed) claimedEddies += amt; else unclaimedEddies += amt;
            }
            if (flags?.corrupted || (flags?.corruption > 0)) corruptedCount++;
          }
        }

        // Sessions → attempts, who got in, last opened.
        const sessions = state.sessions ?? {};
        let attemptCount = 0, breachedBy = null, lastAccessedTs = 0;
        for (const [actorId, session] of Object.entries(sessions)) {
          attemptCount += session.hackAttempts ?? 0;
          if (session.loggedIn || state.decrypted) {
            const a = game.actors?.get(actorId);
            if (a) breachedBy = a.name;
          }
          const ts = session.lastAccessed ?? session.lastLogin ?? 0;
          if (ts > lastAccessedTs) lastAccessedTs = ts;
        }
        let lastAccessedLabel = 'Never';
        if (lastAccessedTs > 0) {
          const ago = (Number(game.nightcity?.timeService?.getCurrentTimeMs?.()) || Date.now()) - lastAccessedTs;   // shard sessions are game time
          if (ago < 60000) lastAccessedLabel = 'just now';
          else if (ago < 3600000) lastAccessedLabel = `${Math.floor(ago / 60000)}m ago`;
          else if (ago < 86400000) lastAccessedLabel = `${Math.floor(ago / 3600000)}h ago`;
          else lastAccessedLabel = `${Math.floor(ago / 86400000)}d ago`;
        }

        const netConfig = config.network ?? {};
        const netRequired = !!(netConfig.required ?? config.requiresNetwork);
        const netId = netRequired ? (netConfig.allowedNetworks?.[0] ?? config.requiredNetwork ?? null) : null;
        const netName = netRequired ? (netId ? (this.networkService?.getNetwork?.(netId)?.name ?? netId) : 'a network') : '';

        // Security layers, in the order a player meets them.
        const anyCleared = (fn) => !!Object.values(sessions).find(fn);
        const isIce = config.encryptionType === 'BLACK_ICE' || config.encryptionType === 'RED_ICE';
        const layers = [];
        if (netRequired) layers.push({ key: 'network', name: 'Network', small: netName, cleared: anyCleared(s => s.hackedLayers?.includes('network')) || status === 'breached' });
        if (config.requiresKeyItem) layers.push({ key: 'keyitem', name: 'Key item', small: config.keyItemName || '', cleared: anyCleared(s => s.keyItemUsed) });
        if (config.requiresLogin) layers.push({ key: 'login', name: 'Login', small: '', cleared: anyCleared(s => s.loggedIn) });
        if (config.encrypted) layers.push({ key: 'encryption', name: isIce ? (config.encryptionType === 'RED_ICE' ? 'Red ICE' : 'Black ICE') : 'Encryption', small: config.encryptionDC ? `DV ${config.encryptionDC}` : '', cleared: !!state.decrypted, ice: isIce });

        const presetIcon = preset?.icon || config.boot?.faIcon || 'fas fa-microchip';
        const presetLabel = preset?.label || 'Custom';
        const name = config.shardName || item.name;

        shards.push({
          itemId: item.id,
          uuid: item.uuid,
          name,
          img: item.img || '',
          ownerKey, ownerName, ownerIcon, ownerImg,
          folderName,
          status,
          statusLabel: STATUS_LABELS[status] || status,
          makerName, makerTag,
          presetKey, presetLabel, presetIcon,
          c: PRESET_COLOR[presetKey] || 'cyan',
          entryCount, corruptedCount, attemptCount, breachedBy,
          integrityEnabled: !!integrity.enabled,
          integrityPercent: integrity.percentage ?? 100,
          integrityTier: integrity.tier || 'clean',
          integrityMode: integrity.mode,
          integrityCfg: integrity.cfg,
          integrityMax: integrity.max ?? integrity.cfg?.maxIntegrity ?? 100,
          integrityCur: integrity.current ?? Math.round((integrity.max ?? integrity.cfg?.maxIntegrity ?? 100) * (integrity.percentage ?? 100) / 100),
          isDamaged: (integrity.enabled && (integrity.percentage ?? 100) < 100) || corruptedCount > 0,
          hardening,
          totalEddies, claimedEddies, unclaimedEddies,
          lastAccessedLabel, lastAccessedTs,
          isDecrypted: !!state.decrypted,
          // Only a WORLD item has ownership of its own; an item on an actor
          // follows the actor, so Permissions renders for world shards only.
          isWorldItem: ownerKey === 'world',
          editMode,
          netName,
          tethered: netConfig.connectionMode === 'tethered',
          capacity: Math.max(0, Math.round(Number(config.capacity) || 0)),
          layers,
          config,
        });
      }
    } catch (error) {
      console.error(`${MODULE_ID} | ShardsTab._gatherData:`, error);
    }
    return shards;
  }

  /** Search + holder — what the Filter menu's counts are taken over. */
  _baseFilter(shards) {
    let out = shards;
    if (this._search) {
      const q = this._search.toLowerCase();
      out = out.filter(s => `${s.name} ${s.ownerName} ${s.presetLabel} ${s.folderName} ${s.makerName}`.toLowerCase().includes(q));
    }
    if (this._ownerFilter === 'world') out = out.filter(s => s.ownerKey === 'world');
    else if (this._ownerFilter === 'actors') out = out.filter(s => s.ownerKey !== 'world');
    return out;
  }

  /** Search + holder + the Filter menu (state picks OR, has picks AND) + sort. */
  _applyFilters(shards) {
    let out = this._baseFilter(shards);
    const picked = SHARD_FILTERS.filter(f => this._filters.has(f.key));
    const states = picked.filter(f => f.kind === 'state');
    const has = picked.filter(f => f.kind === 'has');
    if (states.length) out = out.filter(s => states.some(f => f.test(s)));
    for (const f of has) out = out.filter(f.test);
    out = [...out].sort((a, b) => {
      switch (this._sort) {
        case 'status': return a.status.localeCompare(b.status) || a.name.localeCompare(b.name);
        case 'accessed': return (b.lastAccessedTs || 0) - (a.lastAccessedTs || 0);
        case 'integ': {
          const ia = a.integrityEnabled ? a.integrityPercent : 999, ib = b.integrityEnabled ? b.integrityPercent : 999;
          return ia - ib || a.name.localeCompare(b.name);
        }
        default: return a.name.localeCompare(b.name);
      }
    });
    return out;
  }

  _buildGroups(shards) {
    const mode = SHARD_GROUP_MODES[this._groupMode] ? this._groupMode : 'owner';
    const map = new Map();
    for (const s of shards) {
      let key, name, icon = 'fas fa-folder', img = null, first = false;
      switch (mode) {
        case 'maker':
          // Everything a player forged, grouped by who forged it; the GM's own
          // shards collect under one heading rather than one heading each.
          key = s.makerName ? 'maker:' + s.makerName : 'gm';
          name = s.makerName ? `Made by ${s.makerName}` : 'Made by the GM';
          icon = s.makerName ? 'fas fa-user-pen' : 'fas fa-user-shield';
          break;
        case 'preset':
          key = 'preset:' + s.presetKey; name = s.presetLabel; icon = s.presetIcon; break;
        case 'folder':
          key = 'folder:' + (s.folderName || ''); name = s.folderName || '(no folder)'; icon = 'fas fa-folder'; break;
        case 'status':
          key = 'status:' + s.status; name = s.statusLabel; icon = STATUS_ICONS[s.status] || 'fas fa-circle'; break;
        case 'none':
          key = 'all'; name = 'All shards'; icon = 'fas fa-database'; break;
        default: // owner
          key = s.ownerKey; name = s.ownerName; icon = s.ownerIcon; img = s.ownerImg; first = s.ownerKey === 'world';
      }
      if (!map.has(key)) map.set(key, { key, name, icon, img, first, rows: [] });
      map.get(key).rows.push(this._rowContext(s, mode));
    }
    const groups = [...map.values()];
    groups.sort((a, b) => (a.first ? -1 : b.first ? 1 : a.name.localeCompare(b.name)));
    // Rows stay in the DOM when a bay is folded: the fold is a grid-rows animation,
    // and a folded bay shows a row of state lights instead. Default: the first bay
    // (World items when there are any) open, the rest folded; the bay holding the
    // selection is always open; a search opens every bay; the GM's choices win after.
    // A NEW selection opens its bay once (recorded as an "opened" choice); after that the GM's own fold wins,
    // so folding the bay that holds the selection stays folded (2026-10-28 — the same rule as Contacts and
    // Terminals; it used to spring back open on the next render).
    if (!this._selectMode && !this._search && this._selId !== this._baySelSeen) {   // a search opens every bay anyway
      this._baySelSeen = this._selId;
      const selBay = groups.find(g => g.rows.some(r => r.itemId === this._selId))?.key;
      if (selBay) { this._collapsedGroups.delete(selBay); this._openedGroups.add(selBay); }
    }
    return groups.map((g, index) => {
      const shut = bayShut({ index, key: g.key, opened: this._openedGroups, closed: this._collapsedGroups,
        holdsSel: false, searching: !!this._search });
      this._bayShutNow.set(g.key, shut);
      const peek = peekLights(g.rows);
      return { ...g, count: g.rows.length, shut, lights: peek.lights, more: peek.more, edge: bayColor(mode, g.key), hueName: g.name };
    });
  }

  _rowContext(s, mode) {
    const card = cartridgeView(s, { groupMode: mode, sort: this._sort });
    const parts = [];
    if (s.makerName && mode !== 'maker') parts.push(`by ${s.makerName}`);
    if (mode !== 'folder' && s.folderName) parts.push(s.folderName);
    else if (mode !== 'preset') parts.push(s.presetLabel);
    const lock = s.status === 'blackice' ? 'ice' : s.status === 'locked' ? 'lock' : s.status === 'breached' ? 'open' : '';
    return {
      itemId: s.itemId,
      name: s.name,
      icon: s.presetIcon,
      c: s.c,
      lock,
      lockIcon: lock === 'ice' ? 'fas fa-skull' : lock === 'lock' ? 'fas fa-lock' : lock === 'open' ? 'fas fa-lock-open' : '',
      bricked: s.status === 'destroyed',
      // The status leads the second line in its own colour (locked violet, ICE red, breached green).
      statusLabel: s.status === 'destroyed' ? '' : s.statusLabel,
      statusTone: s.status === 'blackice' ? 'bad' : s.status === 'locked' ? 'secret' : s.status === 'breached' ? 'good' : '',
      // Row edge: bricked = red, damaged = amber (it wants a look).
      edge: s.status === 'destroyed' ? 'bad' : (s.isDamaged ? 'attn' : ''),
      subline: parts.join(' · '),
      eb: s.unclaimedEddies > 0 ? `${s.unclaimedEddies.toLocaleString()} eb` : '',
      dmg: s.isDamaged,
      entries: s.entryCount,
      isSel: !this._selectMode && s.itemId === this._selId,
      isPicked: this._selectedIds.has(s.itemId),
      ...card,
      icon: s.presetIcon,
    };
  }

  /** The selected shard's detail. */
  _detailContext(s) {
    const item = this.app.constructor._findItem?.(s.itemId);
    const ig = s.integrityEnabled ? this._integrityContext(s) : null;
    const dmgRows = (item && s.integrityEnabled && s.integrityMode === 'mechanical') ? this._entryDamage(item, s.integrityCfg) : null;
    const dmgById = new Map((dmgRows?.rows || []).map(r => [r.entryId, r]));

    const entries = (item ? (this.dataShardService?.getShardMessages?.(item) ?? []) : []).map((e) => {
      const info = getContentTypeInfo(e.contentType || 'message');
      const level = entryLevel(e);
      const dr = dmgById.get(e.id);
      const on = Math.round(level * 4);
      const cd = e.contentData || {};
      const es = entryState(level);
      return {
        entryId: e.id,
        state: es.key,
        stateCss: es.css,
        stateIcon: es.icon,
        stateLabel: es.label,
        lost: es.key === 'lost',
        cells: es.cells,
        encDV: e.encryptionDC ? `DV ${e.encryptionDC}` : '',
        icon: info?.icon || 'fas fa-file',
        c: info?.accent || 'cyan',
        hue: entryHue(e.contentType || 'message'),
        title: e.subject || 'Entry',
        type: info?.label || e.contentType,
        ebUnclaimed: e.contentType === 'eddies' && !cd.claimed && (cd.amount ?? 0) > 0 ? `${(cd.amount ?? 0).toLocaleString()} eb` : '',
        ebClaimed: e.contentType === 'eddies' && cd.claimed ? 'Claimed' : '',
        encrypted: !!(e.encrypted && !e.decrypted),
        damaged: level > 0,
        pct: Math.round(level * 100),
        pips: [1, 2, 3, 4].map(n => ({ n, on: n <= on })),
        canSetDamage: !!dmgRows,
        tag: dr?.tag || null,
        lostLabel: dr?.lostLabel || '',
        hiddenTag: !!dr?.hiddenTag,
      };
    });

    const st = stateOf(s.status);
    const entryCountN = entries.length;
    const encN = entries.filter(e => e.encrypted).length;
    const editLabel = s.editMode !== 'locked' ? `Editable · ${SHARD_EDIT_MODES[s.editMode]?.short || s.editMode}` : '';
    const lastOpened = s.lastAccessedTs ? `Last opened${s.breachedBy ? ` by ${s.breachedBy}` : ''} ${s.lastAccessedLabel}.` : '';

    return {
      itemId: s.itemId,
      uuid: s.uuid,
      name: s.name,
      img: s.img || '',
      touched: s.lastAccessedTs ? agoLabel((Number(game.nightcity?.timeService?.getCurrentTimeMs?.()) || Date.now()) - s.lastAccessedTs) : '',
      stateFill: st.tone,
      stateFillIcon: st.icon,
      stateFillLabel: st.label,
      gmMade: !s.makerTag,
      entriesLine: `${entryCountN} · ${encN} encrypted`,
      integOn: !!s.integrityEnabled,
      igv: s.integrityEnabled && s.integrityCfg ? { ...integrityView({ ...s.integrityCfg, currentIntegrity: s.integrityCur ?? s.integrityCfg.currentIntegrity, maxIntegrity: s.integrityMax ?? s.integrityCfg.maxIntegrity }, effectiveHit(s.integrityCfg.degradePerFailure ?? 15, s.integrityCfg.hardening ?? 0)), degrade: s.integrityCfg.degradePerFailure ?? 15, repairPts: s.integrityCfg.repairPts ?? 15, mechanical: s.integrityMode === 'mechanical', canSalvage: !!s.integrityCfg.dead?.salvage } : null,
      icon: s.presetIcon,
      c: s.c,
      isWorld: s.ownerKey === 'world',
      holderName: s.ownerKey === 'world' ? 'World item' : s.ownerName.replace(/’s gear$/, ''),
      holderImg: s.ownerImg,
      presetLabel: s.presetLabel,
      folderName: s.folderName,
      makerTag: s.makerTag,
      editLabel,
      hardening: s.hardening,
      netName: s.netName,
      tethered: s.tethered,
      isWorldItem: s.isWorldItem,
      isDecrypted: s.isDecrypted,
      statusLabel: s.statusLabel,
      statusTone: STATUS_TONE[s.status] || 'is-plain',
      statusIcon: STATUS_ICONS[s.status] || '',
      bricked: s.status === 'destroyed',
      // The breach path: each layer a stop from the outside in. The tooltip says what the
      // lock IS (the sentence the "doors" mock spelled out) and what clicking does.
      layers: s.layers.map((l, i) => {
        const nextIdx = s.layers.findIndex(x => !x.cleared);
        const what = {
          network: `Only reachable on ${l.small || 'a network'}`,
          keyitem: `Needs ${l.small || 'a key item'}`,
          login: 'An account login',
          encryption: l.ice ? `${l.name}${l.small ? ` at ${l.small}` : ''} — a failed breach hits the runner` : `A cipher${l.small ? ` at ${l.small}` : ''}`,
        }[l.key] || l.name;
        return {
          ...l,
          cls: l.cleared ? 'done' : (l.ice ? 'ice' : 'lock'),
          icon: { network: 'fas fa-wifi', keyitem: 'fas fa-key', login: 'fas fa-user-lock', encryption: l.ice ? 'fas fa-skull' : 'fas fa-lock' }[l.key] || 'fas fa-lock',
          stateIcon: l.cleared ? 'fas fa-check' : (l.ice ? 'fas fa-bolt' : 'fas fa-lock'),
          isNext: i === nextIdx && !l.ice,
          tip: `${what}. Click to ${l.cleared ? 'relock from here' : 'unlock through here'} for everyone.`,
        };
      }),
      hasLayers: s.layers.length > 0,
      layerOpen: s.layers.filter(l => l.cleared).length,
      layerCount: s.layers.length,
      breached: s.layers.length > 0 && s.layers.every(l => l.cleared),
      nextLayer: s.layers.find(l => !l.cleared)?.name || '',
      tightPath: s.layers.length >= 4,
      lastOpened,
      attempts: s.attemptCount,
      entries,
      entryCount: entries.length || s.entryCount,
      capacityLabel: s.capacity ? `${entries.length} / ${s.capacity}` : '',
      unclaimedEb: s.unclaimedEddies > 0 ? s.unclaimedEddies.toLocaleString() : '',
      damagedEntries: dmgRows?.damaged || 0,
      ig,
      canPop: !this.isPopout,
      shut: Object.fromEntries(DETAIL_SECTIONS.map(k => [k, this._secShut.has(k)])),
      // What a CLOSED band says next to its heading (plain words, meaning colours).
      sum: {
        path: pathSummary(s.layers, s.attemptCount || 0),
        integ: integSummary(s.integrityEnabled && s.integrityCfg ? integrityView({ ...s.integrityCfg, currentIntegrity: s.integrityCur ?? s.integrityCfg.currentIntegrity, maxIntegrity: s.integrityMax ?? s.integrityCfg.maxIntegrity }, 1) : null),
        ents: entsSummary({
          count: entries.length || s.entryCount || 0,
          lost: entries.filter(e => e.lost).length,
          damaged: entries.filter(e => e.damaged && !e.lost).length,
          encrypted: encN,
          unclaimedEb: s.unclaimedEddies || 0,
        }),
      },
    };
  }

  _integrityContext(s) {
    const pct = s.integrityPercent;
    return {
      pct,
      tier: s.integrityTier,
      presets: [100, 75, 50, 25, 0].map(v => ({ v, on: v === pct, danger: v === 0 })),
      hardening: s.hardening,
      degrade: s.integrityCfg?.degradePerFailure ?? 15,
      mechanical: s.integrityMode === 'mechanical',
    };
  }

  /** Player authoring strip — the Shard Encoder's GM entry point. */
  _authContext(all) {
    const raw = this.settingsManager?.getEncoderConfigRaw?.() ?? (this.settingsManager?.get?.('encoderConfig') || {});
    let cfg;
    try { cfg = resolveEncoderConfig(raw); } catch { cfg = { enabled: !!raw?.enabled }; }
    const on = !!cfg.enabled;
    const made = all.filter(s => s.makerName).length;
    const facts = [];
    if (on) {
      const g = cfg.gate ? gateSummary(cfg.gate) : null;
      facts.push({ icon: 'fas fa-user-check', text: !g || !g.gated ? 'Anyone may encode' : g.inert ? 'Gated, but no rule set yet' : g.parts.join(' or ') });
      facts.push({ icon: 'fas fa-sd-card', text: BLANK_FACT[cfg.blanks?.source] || BLANK_FACT.gear });
      facts.push({ icon: 'fas fa-tag', text: PRICE_FACT[cfg.pricing] || PRICE_FACT.propose });
    }
    return { on, made, madeLabel: `${made} made by player${made === 1 ? '' : 's'}`, facts };
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers (static delegators on AdminPanelApp)
  // ═══════════════════════════════════════════════════════════

  onOpenShardItem(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    const item = this.app.constructor._findItem(itemId);
    if (!item) return;
    if (item.getFlag(MODULE_ID, 'isDataShard') && game.nightcity?.openDataShard) game.nightcity.openDataShard(item);
    else item.sheet.render(true);
    log.info(`Admin: Opening shard ${item.name}`);
  }

  async onForceDecrypt(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    const item = this.app.constructor._findItem(itemId);
    if (!item) return;
    const confirmed = await adminConfirm({
      title: 'Force Decrypt',
      content: `<p>Force-decrypt <strong>${item.name}</strong>? This bypasses all security.</p>`,
    });
    if (!confirmed) return;
    await item.update({ [`flags.${MODULE_ID}.state.decrypted`]: true });
    ui.notifications.info(`Force-decrypted: ${item.name}`);
    this.render(true);
  }

  async onRelockShard(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    const item = this.app.constructor._findItem(itemId);
    if (!item) return;
    const confirmed = await adminConfirm({
      title: 'Relock Shard',
      content: `<p>Relock <strong>${item.name}</strong>? All security state will be fully reset (encryption, login, key item, hack attempts, lockout, boot, expiration).</p>`,
    });
    if (!confirmed) return;
    await this._relock(item);
    this.render(true);
  }

  async _relock(item) {
    try {
      this.app._animationActive = true;
      const result = await this.dataShardService?.relockShard(item);
      this.app._animationActive = false;
      if (result?.success) ui.notifications.info(`NCM | Relocked: ${item.name}`);
      else ui.notifications.error(`NCM | Relock failed: ${result?.error || 'Unknown'}`);
    } catch (err) {
      this.app._animationActive = false;
      console.error(`${MODULE_ID} | relockShard failed:`, err);
      ui.notifications.error(`NCM | Relock failed: ${err.message}`);
    }
  }

  async onConvertItem(event, target) {
    const candidates = [];
    const seenIds = new Set();
    const types = new Set();
    const sources = new Map(); // source name → count

    for (const item of (game.items ?? [])) {
      if (item.getFlag(MODULE_ID, 'isDataShard')) continue;
      candidates.push({ id: item.id, name: item.name, type: item.type, source: 'World', uuid: item.uuid, img: item.img });
      seenIds.add(item.id);
      types.add(item.type);
      sources.set('World', (sources.get('World') || 0) + 1);
    }
    for (const actor of (game.actors ?? [])) {
      for (const item of actor.items) {
        if (seenIds.has(item.id) || item.getFlag(MODULE_ID, 'isDataShard')) continue;
        candidates.push({ id: item.id, name: item.name, type: item.type, source: actor.name, uuid: item.uuid, img: item.img });
        types.add(item.type);
        sources.set(actor.name, (sources.get(actor.name) || 0) + 1);
      }
    }

    if (!candidates.length) {
      ui.notifications.warn('NCM | No unconverted items found. Create an item first.');
      return;
    }

    const esc = Handlebars.escapeExpression;
    candidates.sort((a, b) => a.name.localeCompare(b.name));
    const typeOpts = [...types].sort().map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    const tabsHtml = [
      `<button class="ncm-pick__tab ncm-pick__tab--active" data-source="">All<span class="ncm-pick__tab-count">${candidates.length}</span></button>`,
      ...[...sources.entries()].map(([name, count]) =>
        `<button class="ncm-pick__tab" data-source="${esc(name)}">${esc(name)}<span class="ncm-pick__tab-count">${count}</span></button>`),
    ].join('');

    const uuid = await new Promise(resolve => {
      adminDialog({
        title: 'Convert Item to Data Shard',
        content: `
          <div class="ncm-pick__controls">
            <div class="ncm-pick__search-wrap">
              <i class="fas fa-search"></i>
              <input type="text" class="ncm-pick__search" id="ncm-pick-search" placeholder="Search items..." autocomplete="off">
            </div>
            <select class="ncm-pick__filter" id="ncm-pick-type"><option value="">All types</option>${typeOpts}</select>
          </div>
          <div class="ncm-pick__tabs" id="ncm-pick-tabs">${tabsHtml}</div>
          <div class="ncm-pick__list" id="ncm-pick-list">
            ${candidates.map(c => `
              <div class="ncm-pick__item" data-uuid="${c.uuid}" data-name="${esc(c.name.toLowerCase())}" data-type="${esc(c.type)}" data-source="${esc(c.source)}">
                <img class="ncm-pick__item-img" src="${c.img || 'icons/svg/item-bag.svg'}" width="30" height="30">
                <div style="flex:1;min-width:0;">
                  <div class="ncm-pick__item-name">${esc(c.name)}</div>
                  <div class="ncm-pick__item-meta">${esc(c.source)}</div>
                </div>
                <span class="ncm-pick__item-type">${esc(c.type)}</span>
              </div>
            `).join('')}
          </div>
          <div class="ncm-pick__count" id="ncm-pick-count">${candidates.length} items</div>`,
        buttons: {
          convert: { label: '<i class="fas fa-microchip"></i> Convert', callback: html => {
            const sel = html[0].querySelector('.ncm-pick__item--selected');
            resolve(sel?.dataset.uuid || null);
          } },
          cancel: { label: 'Cancel', callback: () => resolve(null) },
        },
        default: 'convert',
        close: () => resolve(null),
        render: html => {
          const root = html[0] ?? html;
          const search = root.querySelector('#ncm-pick-search');
          const typeFilter = root.querySelector('#ncm-pick-type');
          const tabs = root.querySelector('#ncm-pick-tabs');
          const list = root.querySelector('#ncm-pick-list');
          const count = root.querySelector('#ncm-pick-count');
          let activeSource = '';
          const filter = () => {
            const q = search.value.toLowerCase();
            const t = typeFilter.value;
            let visible = 0;
            list.querySelectorAll('.ncm-pick__item').forEach(el => {
              const show = (!q || el.dataset.name.includes(q)) && (!t || el.dataset.type === t) && (!activeSource || el.dataset.source === activeSource);
              el.dataset.hidden = !show;
              if (show) visible++;
            });
            count.textContent = `${visible} item${visible !== 1 ? 's' : ''}`;
          };
          search.addEventListener('input', filter);
          typeFilter.addEventListener('change', filter);
          tabs.addEventListener('click', (ev) => {
            const tab = ev.target.closest('.ncm-pick__tab');
            if (!tab) return;
            tabs.querySelectorAll('.ncm-pick__tab').forEach(t => t.classList.remove('ncm-pick__tab--active'));
            tab.classList.add('ncm-pick__tab--active');
            activeSource = tab.dataset.source;
            filter();
          });
          list.addEventListener('click', (ev) => {
            const el = ev.target.closest('.ncm-pick__item');
            if (!el) return;
            list.querySelectorAll('.ncm-pick__item--selected').forEach(s => s.classList.remove('ncm-pick__item--selected'));
            el.classList.add('ncm-pick__item--selected');
          });
          list.addEventListener('dblclick', (ev) => {
            const el = ev.target.closest('.ncm-pick__item');
            if (el) { el.classList.add('ncm-pick__item--selected'); root.closest('.dialog')?.querySelector('[data-button="convert"]')?.click(); }
          });
          search.focus();
        },
      }, { width: 440, classes: ['ncm-pick-dialog'] }).render(true);
    });

    if (!uuid) return;
    const item = await fromUuid(uuid);
    if (!item) { ui.notifications.error('NCM | Item not found.'); return; }

    const result = await this.dataShardService?.convertToDataShard(item);
    if (result?.success) {
      ui.notifications.info(`NCM | "${item.name}" converted to data shard.`);
      ui.items?.render();
      this._selId = item.id;
      this.render();
    } else {
      ui.notifications.error(`NCM | Failed: ${result?.error || 'Unknown error'}`);
    }
  }

  async onQuickCreateShard(event, target) {
    const presetKey = target.closest('[data-preset]')?.dataset.preset;
    if (!presetKey) return;

    // "New Blank Shard" CREATES a fresh world item, converts it, and opens
    // Configure (dev, 2026-09-10). The preset entries still convert an EXISTING item.
    if (presetKey === 'blank') return this._createBlankShard();

    const items = game.items?.filter(i => !i.getFlag(MODULE_ID, 'isDataShard')) ?? [];
    if (!items.length) {
      ui.notifications.warn('NCM | No unconverted items available. Create an item first.');
      return;
    }
    // Searchable picker (folder chips + type note) — never a <select> of every world item.
    const pick = await showNamePicker({
      title: 'Quick Create Shard',
      hint: `Pick the item to convert with the ${presetKey} preset.`,
      entries: documentEntries(items, { note: (i) => i.type }),
      placeholder: 'search items or folders…',
    });
    const item = pick?.id ? game.items.get(pick.id) : null;
    if (!item) return;

    const result = await this.dataShardService?.convertToDataShard(item, {}, presetKey);
    if (result?.success) {
      ui.notifications.info(`NCM | Created "${item.name}" with ${presetKey} preset.`);
      this._selId = item.id;
      this.render();
    } else {
      ui.notifications.error(`NCM | Failed: ${result?.error || 'Unknown error'}`);
    }
  }

  /**
   * Copy actor-held shards into the Items directory, in folders.
   *
   * The honest framing matters here: an item embedded in an actor CANNOT be
   * foldered, and moving it would take the player's shard off their sheet. So
   * these are reference copies that share the original's journal — open one and
   * you are reading the player's real shard, live.
   */
  async onArchiveShards() {
    const svc = this.dataShardService;
    if (!svc?.surveyShardArchive) { ui.notifications.error('NCM | Data shard service unavailable.'); return; }

    const esc = Handlebars.escapeExpression;
    let playerOnly = true;
    let prune = false;

    const paint = (root) => {
      const survey = svc.surveyShardArchive({ playerMadeOnly: playerOnly });
      const list = survey.pending.slice(0, 8).map(r =>
        `<div class="ncm-arch-row"><b>${esc(r.name)}</b><span>${esc(r.maker)}</span></div>`).join('');
      const more = survey.pending.length > 8 ? `<div class="ncm-arch-more">+ ${survey.pending.length - 8} more</div>` : '';
      root.querySelector('[data-arch-body]').innerHTML = survey.pending.length
        ? `<div class="ncm-arch-list">${list}${more}</div>`
        : '<div class="ncm-arch-empty">Nothing new to copy — every shard that qualifies already has a copy here.</div>';
      root.querySelector('[data-arch-count]').textContent = String(survey.pending.length);
      const orph = root.querySelector('[data-arch-orphans]');
      orph.hidden = !survey.orphans.length;
      orph.querySelector('b').textContent = String(survey.orphans.length);
    };

    const survey0 = svc.surveyShardArchive({ playerMadeOnly: true });
    let ran = null;
    const dlg = adminDialog({
      title: 'Copy shards into the Items directory',
      content: `
        <div class="ncm-arch">
          <p class="ncm-arch-lede">A shard lives in a character's gear, and an item inside an actor cannot go in a folder.
             These are <b>reference copies</b> in the world Items list, filed under <b>Player-Made Shards → the character</b>.
             Each one shares the original's journal, so opening a copy shows the real contents — and deleting a copy never
             touches the player's shard.</p>
          <label class="ncm-arch-opt"><input type="checkbox" data-arch-players checked> Player-made shards only
            <small>Untick to copy every shard any character is carrying.</small></label>
          <div class="ncm-arch-head">To copy: <b data-arch-count>${survey0.pending.length}</b></div>
          <div data-arch-body></div>
          <label class="ncm-arch-opt" data-arch-orphans ${survey0.orphans.length ? '' : 'hidden'}>
            <input type="checkbox" data-arch-prune> Also delete <b>${survey0.orphans.length}</b> copies whose shard is gone
          </label>
        </div>`,
      buttons: {
        go: {
          icon: '<i class="fas fa-folder-plus"></i>', label: 'Copy them',
          callback: () => { ran = { playerMadeOnly: playerOnly, pruneOrphans: prune }; },
        },
        cancel: { label: 'Cancel' },
      },
      default: 'go',
      render: (html) => {
        const root = html[0] ?? html;
        paint(root);
        root.querySelector('[data-arch-players]')?.addEventListener('change', (ev) => {
          playerOnly = ev.target.checked; paint(root);
        });
        root.querySelector('[data-arch-prune]')?.addEventListener('change', (ev) => { prune = ev.target.checked; });
      },
      close: async () => {
        if (!ran) return;
        const res = await svc.archiveShardsToItems(ran);
        if (res.error) { ui.notifications.error(`NCM | ${res.error}`); return; }
        if (!res.created && !res.orphansRemoved) { ui.notifications.info('NCM | Nothing to copy.'); return; }
        ui.notifications.info(`NCM | Copied ${res.created} shard${res.created === 1 ? '' : 's'} into the Items directory${res.orphansRemoved ? `, removed ${res.orphansRemoved} stale cop${res.orphansRemoved === 1 ? 'y' : 'ies'}` : ''}.`);
        ui.items?.render(true);
        this.app.render();
      },
    }, { width: 520 });
    dlg.render(true);
  }

  /** Admin → Shards → Player Authoring — open the Encoder's GM config window. */
  async onOpenEncoderConfig() {
    const { EncoderConfigApp } = await import('../../ShardEncoder/EncoderConfigApp.js');
    const existing = Object.values(ui.windows).find(w => w.id === 'ncm-encoder-config')
      ?? foundry.applications?.instances?.get?.('ncm-encoder-config');
    if (existing) { existing.bringToTop?.(); existing.bringToFront?.(); return; }
    new EncoderConfigApp().render(true);
  }

  /** "Turn on" on the Off strip — flip the master switch, keep every other choice. */
  async onAuthoringOn() {
    const sm = this.settingsManager;
    if (!sm?.setEncoderConfig) { ui.notifications.error('NCM | Settings unavailable.'); return; }
    const raw = sm.getEncoderConfigRaw?.() ?? {};
    await sm.setEncoderConfig({ ...raw, enabled: true });
    ui.notifications.info('NCM | Player authoring is on. Open Player Authoring to choose who may encode and on what.');
    this.render();
  }

  async _createBlankShard() {
    const types = (game.documentTypes?.Item || game.system?.documentTypes?.Item || []).filter(t => t !== 'base');
    const type = types.includes('gear') ? 'gear' : (types[0] || 'gear');
    const existing = (game.items?.contents ?? []).filter(i => /^New Data Shard/.test(i.name)).length;
    const name = existing ? `New Data Shard ${existing + 1}` : 'New Data Shard';

    let item = null;
    try {
      item = await Item.create({ name, type, img: 'icons/svg/item-bag.svg' });
    } catch (err) {
      log.warn(`Blank shard: Item.create failed — ${err?.message || err}`);
    }
    if (!item) { ui.notifications.error('NCM | Could not create the item.'); return; }

    const result = await this.dataShardService?.convertToDataShard(item, {}, 'blank');
    if (!result?.success) {
      ui.notifications.error(`NCM | Failed: ${result?.error || 'Unknown error'}`);
      return;
    }
    ui.notifications.info(`NCM | Created "${item.name}" — configure it now.`);
    this._selId = item.id;
    this.render();
    const { ItemInboxConfig } = await import('../../ItemInbox/ItemInboxConfig.js');
    new ItemInboxConfig({ item }).render(true);
  }

  async onBulkRelockAll() {
    const shards = this._getAllDataShards().filter(i => (i.getFlag(MODULE_ID, 'state') ?? {}).decrypted === true);
    if (!shards.length) { ui.notifications.info('NCM | No breached shards to relock.'); return; }
    const confirmed = await adminConfirm({
      title: 'Relock All Shards',
      content: `<p>Relock <strong>${shards.length}</strong> breached shard${shards.length > 1 ? 's' : ''}? All session data will be reset.</p>`,
    });
    if (!confirmed) return;
    try {
      this.app._animationActive = true;
      for (const item of shards) await this.dataShardService?.relockShard(item);
    } catch (err) {
      console.error(`${MODULE_ID} | bulkRelockAll failed:`, err);
    } finally {
      this.app._animationActive = false;
    }
    ui.notifications.info(`NCM | ${shards.length} shard${shards.length > 1 ? 's' : ''} relocked.`);
    this.render();
  }

  async onPurgeDestroyed() {
    const destroyed = this._getAllDataShards().filter(i => (i.getFlag(MODULE_ID, 'state') ?? {}).destroyed === true
      || this.dataShardService?.checkIntegrity?.(i)?.isBricked);
    if (!destroyed.length) { ui.notifications.info('NCM | No bricked shards to purge.'); return; }
    const confirmed = await adminConfirm({
      title: 'Purge Bricked Shards',
      content: `<p>Remove shard data from <strong>${destroyed.length}</strong> bricked shard${destroyed.length > 1 ? 's' : ''}? The items stay, but lose their shard data and journal.</p>`,
    });
    if (!confirmed) return;
    for (const item of destroyed) await this.dataShardService?.removeDataShard(item, true);
    ui.notifications.info(`NCM | ${destroyed.length} bricked shard${destroyed.length > 1 ? 's' : ''} purged.`);
    this.render();
  }

  /**
   * Open Foundry's own ownership dialog for a WORLD shard — the one step a GM
   * handing a shard over outright used to have to find in the item sheet.
   * (A player hacking a shard does NOT need this any more: state writes relay.)
   */
  onShardOwnership(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    const item = itemId ? this.app.constructor._findItem(itemId) : null;
    if (!item) return;
    if (item.parent) { ui.notifications?.info(`NCM | "${item.name}" is on ${item.parent.name}'s sheet — it follows that character's permissions.`); return; }
    // v12: a global lexical class (bare reference); v13 moves it under the namespace.
    const Cls = (typeof DocumentOwnershipConfig !== 'undefined') ? DocumentOwnershipConfig : foundry.applications?.apps?.DocumentOwnershipConfig;
    if (!Cls) { ui.notifications?.warn('NCM | The ownership dialog is not available in this Foundry version.'); return; }
    try { new Cls(item).render(true); }
    catch (err) { log.warn('ShardsTab: ownership dialog failed', err); ui.notifications?.warn('NCM | Could not open the ownership dialog.'); }
  }

  onConfigureShardItem(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    const item = this.app.constructor._findItem(itemId);
    if (!item) return;
    import('../../ItemInbox/ItemInboxConfig.js').then(({ ItemInboxConfig }) => {
      new ItemInboxConfig({ item }).render(true);
    });
  }

  async onRelockShardItem(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    const item = itemId ? this.app.constructor._findItem(itemId) : null;
    if (!item) return;
    await this._relock(item);
    this.render();
  }

  // ─── Legacy handlers still bound on AdminPanelApp (kept so nothing dangles) ───

  onToggleGroup(event, target) { return this.onAct('group', event, target); }
  onToggleSelectMode(event, target) { return this.onAct('bulk', event, target); }
  onToggleSelect(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    this._selectedIds.has(itemId) ? this._selectedIds.delete(itemId) : this._selectedIds.add(itemId);
    this.render();
  }
  onDeselectAll() { this._selectedIds.clear(); this.render(); }
  onExpand(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (itemId) { this._selId = itemId; this.render(); }
  }
  onCycleSort() { const o = Object.keys(SHARD_SORTS); this._sort = o[(o.indexOf(this._sort) + 1) % o.length]; this.render(); }
  onCycleIceFilter() { this._filters.has('ice') ? this._filters.delete('ice') : this._filters.add('ice'); this.render(); }
  onCycleStatusFilter() {
    const o = ['', 'locked', 'breached', 'open', 'bricked'];
    const cur = o.find(k => k && this._filters.has(k)) || '';
    for (const k of o) if (k) this._filters.delete(k);
    const next = o[(o.indexOf(cur) + 1) % o.length];
    if (next) this._filters.add(next);
    this.render();
  }
  onCyclePresetFilter() { this._groupMode = 'preset'; this.render(); }
  onCycleOwnerFilter() { const o = Object.keys(SHARD_HOLDERS); this._ownerFilter = o[(o.indexOf(this._ownerFilter) + 1) % o.length]; this.render(); }
  onCycleGroupMode() { const o = Object.keys(SHARD_GROUP_MODES); this._groupMode = o[(o.indexOf(this._groupMode) + 1) % o.length]; this._collapsedGroups.clear(); this._openedGroups.clear(); this._baySelSeen = undefined; this.render(); }

  // ─── Bulk ───

  async onBulkRelockSelected() {
    const ids = [...this._selectedIds];
    if (!ids.length) return;
    const confirmed = await adminConfirm({
      title: 'Relock Selected Shards',
      content: `<p>Relock <strong>${ids.length}</strong> selected shard${ids.length > 1 ? 's' : ''}? All session data will be reset.</p>`,
    });
    if (!confirmed) return;
    this.app._animationActive = true;
    try {
      for (const id of ids) {
        const item = this.app.constructor._findItem(id);
        if (item) await this.dataShardService?.relockShard(item);
      }
    } finally { this.app._animationActive = false; }
    this._selectedIds.clear();
    ui.notifications.info(`NCM | ${ids.length} shard${ids.length > 1 ? 's' : ''} relocked.`);
    this.render();
  }

  onBulkExportSelected() { return this._exportShards([...this._selectedIds]); }

  async onBulkUnconvertSelected() {
    const items = [...this._selectedIds].map(id => this.app.constructor._findItem(id)).filter(Boolean);
    if (!items.length) return;
    const confirmed = await adminConfirm({
      title: 'Unconvert Selected Shards',
      content: `<p>Turn <strong>${items.length}</strong> shard${items.length > 1 ? 's' : ''} back into plain items? Each gets its old name and art back. The journals are kept, detached.</p>`,
    });
    if (!confirmed) return;
    let done = 0;
    for (const item of items) {
      const res = await this.dataShardService?.removeDataShard(item, false);
      if (res?.success) done++;
    }
    this._selectedIds.clear();
    ui.notifications.info(`NCM | ${done} of ${items.length} unconverted.`);
    ui.items?.render();
    this.render();
  }

  /**
   * Export shards as JSON — config AND entries, so Import can rebuild them.
   * Envelope: { ncmShards: 1, exportedAt, shards: [{ name, img, type, config, entries }] }.
   */
  _exportShards(ids) {
    if (!ids.length) return;
    const svc = this.dataShardService;
    const shards = [];
    for (const id of ids) {
      const item = this.app.constructor._findItem(id);
      if (!item) continue;
      const config = foundry.utils.deepClone(item.getFlag(MODULE_ID, 'config') ?? {});
      const entries = (svc?.getShardMessages?.(item) ?? []).map(e => {
        const { id: _id, pageId: _p, decrypted: _d, corrupted: _c, corruption: _x, ...rest } = e;
        return rest;
      });
      shards.push({ name: item.name, img: item.img, type: item.type, config, entries });
    }
    const data = { ncmShards: 1, exportedAt: new Date().toISOString(), shards };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-shards-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info(`NCM | Exported ${shards.length} shard${shards.length !== 1 ? 's' : ''}.`);
  }

  /**
   * Turn an export file into a list of shard records. Accepts the envelope above
   * or the old bare-array bulk export (`[{ name, config, state }]`, no entries).
   * Pure — the sim drives it.
   * @returns {{ shards: Array<{name, img, type, config, entries}>, error?: string }}
   */
  static parseShardImport(text) {
    let data;
    try { data = JSON.parse(text); } catch { return { shards: [], error: 'That file is not valid JSON.' }; }
    const list = Array.isArray(data) ? data : (Array.isArray(data?.shards) ? data.shards : null);
    if (!list) return { shards: [], error: 'No shards in that file.' };
    const shards = list
      .filter(s => s && typeof s === 'object' && s.config && typeof s.config === 'object')
      .map(s => ({
        name: String(s.name || s.config.shardName || 'Imported Shard'),
        img: typeof s.img === 'string' && s.img ? s.img : 'icons/svg/item-bag.svg',
        type: typeof s.type === 'string' ? s.type : '',
        config: s.config,
        entries: Array.isArray(s.entries) ? s.entries.filter(e => e && typeof e === 'object') : [],
      }));
    if (!shards.length) return { shards: [], error: 'No shards in that file.' };
    return { shards };
  }

  /** Import from JSON — each record becomes a NEW world item, converted, with its entries. */
  async onImportShards() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const { shards, error } = ShardsTab.parseShardImport(await file.text());
      if (error) { ui.notifications.warn(`NCM | ${error}`); return; }
      const ok = await adminConfirm({
        title: 'Import Shards',
        content: `<p>Create <strong>${shards.length}</strong> new world item${shards.length > 1 ? 's' : ''} as shards, with ${shards.reduce((n, s) => n + s.entries.length, 0)} entries? Each starts locked; nothing existing is changed.</p>`,
      });
      if (!ok) return;
      const res = await this._importShardRecords(shards);
      ui.notifications.info(`NCM | Imported ${res.created} shard${res.created !== 1 ? 's' : ''}${res.failed ? ` · ${res.failed} failed` : ''}${res.entryFailed ? ` · ${res.entryFailed} entries refused` : ''}.`);
      ui.items?.render();
      this.render();
    });
    input.click();
  }

  async _importShardRecords(shards) {
    const types = (game.documentTypes?.Item || game.system?.documentTypes?.Item || []).filter(t => t !== 'base');
    const fallbackType = types.includes('gear') ? 'gear' : (types[0] || 'gear');
    let created = 0, failed = 0, entryFailed = 0, lastId = null;
    for (const s of shards) {
      let item = null;
      try {
        item = await Item.create({ name: s.name, type: types.includes(s.type) ? s.type : fallbackType, img: s.img });
      } catch (err) { log.warn(`Shard import: Item.create failed — ${err?.message || err}`); }
      if (!item) { failed++; continue; }
      const config = foundry.utils.deepClone(s.config);
      const res = await this.dataShardService?.convertToDataShard(item, config, null);
      if (!res?.success) { failed++; continue; }
      for (const e of s.entries) {
        const r = await this.dataShardService?.addMessage(item, e);
        if (!r?.success) entryFailed++;
      }
      created++;
      lastId = item.id;
    }
    if (lastId) this._selId = lastId;
    return { created, failed, entryFailed };
  }

  async onUnconvertShard(event, target) {
    event?.stopPropagation?.();
    const itemId = target?.closest?.('[data-item-id]')?.dataset.itemId;

    let item;
    if (itemId) {
      item = this.app.constructor._findItem(itemId);
    } else {
      // No row given (the ⋯ menu's "Unconvert a shard…") — pick one.
      const shards = this._getAllDataShards();
      if (!shards.length) { ui.notifications.warn('NCM | No data shards to unconvert.'); return; }
      const pick = await showNamePicker({
        title: 'Unconvert a Data Shard',
        hint: 'The item gets its old name and art back. Its journal is kept, detached.',
        entries: shards.map(s => ({ id: s.id, name: s.name, img: s.img, sub: s.parent ? `${s.parent.name}’s gear` : 'World item', group: s.parent ? 'Characters' : 'World' })),
        placeholder: 'search shards…',
      });
      item = pick?.id ? this.app.constructor._findItem(pick.id) : null;
    }
    if (!item) return;

    const confirmed = await adminConfirm({
      title: 'Unconvert Data Shard',
      content: `<p>Turn <strong>${item.name}</strong> back into a plain item? It gets its old name and art back. Its entries stay in the journal, detached.</p>`,
    });
    if (!confirmed) return;

    // removeDataShard is the one door: it strips the flags AND restores the name/art
    // the item had before it was a shard (an archive copy keeps its own).
    const res = await this.dataShardService?.removeDataShard(item, false);
    if (!res?.success) { ui.notifications.error(`NCM | Unconvert failed: ${res?.error || 'Unknown'}`); return; }
    ui.notifications.info(`NCM | Unconverted: ${item.name} is now a regular item.`);
    ui.items?.render();
    this.render();
  }

  async onToggleLayer(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    const layer = target.closest('[data-layer]')?.dataset.layer;
    if (!itemId || !layer) return;
    const item = this.app.constructor._findItem(itemId);
    if (!item) { console.warn(`${MODULE_ID} | toggleShardLayer: item ${itemId} not found`); return; }

    const state = item.getFlag(MODULE_ID, 'state') ?? {};
    const sessions = foundry.utils.deepClone(state.sessions ?? {});
    let isCleared = false;
    switch (layer) {
      case 'network': isCleared = !!Object.values(sessions).find(s => s.hackedLayers?.includes('network')); break;
      case 'keyitem': isCleared = !!Object.values(sessions).find(s => s.keyItemUsed); break;
      case 'login': isCleared = !!Object.values(sessions).find(s => s.loggedIn); break;
      case 'encryption': isCleared = state.decrypted ?? false; break;
    }

    const confirmed = await adminConfirm({
      title: `${isCleared ? 'Relock' : 'Unlock'} Security Layer`,
      content: `<p>${isCleared ? 'Relock' : 'Force-clear'} the <strong>${layer}</strong> layer on <strong>${item.name}</strong>?${isCleared ? ' All layers from this point forward will also be relocked.' : ''}</p>`,
    });
    if (!confirmed) return;

    const layerIdx = LAYER_ORDER.indexOf(layer);
    const newState = foundry.utils.deepClone(state);

    if (isCleared) {
      for (const session of Object.values(newState.sessions ?? {})) {
        const hackedLayers = [...(session.hackedLayers || [])];
        for (let i = layerIdx; i < LAYER_ORDER.length; i++) {
          const l = LAYER_ORDER[i];
          const hIdx = hackedLayers.indexOf(l);
          if (hIdx !== -1) hackedLayers.splice(hIdx, 1);
          if (l === 'keyitem') session.keyItemUsed = false;
          if (l === 'login') session.loggedIn = false;
        }
        session.hackedLayers = hackedLayers;
      }
      newState.decrypted = false;
      newState.gmBypassed = false;
    } else {
      if (!newState.sessions) newState.sessions = {};
      const gmSession = newState.sessions['gm-override']
        || { hackedLayers: [], hackAttempts: 0, loggedIn: false, keyItemUsed: false, keyItemAttempts: 0, loginAttempts: 0, layerHackAttempts: {}, layerLockoutUntil: null, lockoutUntil: null };
      const hackedLayers = [...(gmSession.hackedLayers || [])];
      for (let i = 0; i <= layerIdx; i++) {
        const l = LAYER_ORDER[i];
        if (!hackedLayers.includes(l)) hackedLayers.push(l);
        if (l === 'keyitem') gmSession.keyItemUsed = true;
        if (l === 'login') gmSession.loggedIn = true;
      }
      gmSession.hackedLayers = hackedLayers;
      newState.sessions['gm-override'] = gmSession;
      if (layer === 'encryption') { newState.decrypted = true; newState.gmBypassed = true; }
    }

    try {
      // Suppress debounced re-renders during the two-step flag write.
      this.app._animationActive = true;
      await item.unsetFlag(MODULE_ID, 'state');
      await item.setFlag(MODULE_ID, 'state', newState);
      this.app._animationActive = false;
      ui.notifications.info(`NCM | ${isCleared ? 'Relocked' : 'Force-cleared'} ${item.name} ${isCleared ? 'from' : 'through'} ${layer} layer.`);
    } catch (err) {
      this.app._animationActive = false;
      console.error(`${MODULE_ID} | toggleShardLayer failed:`, err);
      ui.notifications.error(`NCM | Layer toggle failed: ${err.message}`);
    }
    this.render();
  }

  async onForceDecryptShardItem(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    const item = this.app.constructor._findItem(itemId);
    if (!item) { console.warn(`${MODULE_ID} | forceDecryptShardItem: item ${itemId} not found`); return; }

    const state = item.getFlag(MODULE_ID, 'state') ?? {};
    if (state.decrypted) {
      // Already decrypted → relock (DataShardService uses unsetFlag/setFlag).
      await this._relock(item);
    } else {
      try {
        const newState = foundry.utils.deepClone(state);
        newState.decrypted = true;
        newState.gmBypassed = true;
        if (!newState.sessions) newState.sessions = {};
        const config = item.getFlag(MODULE_ID, 'config') ?? {};
        const gmSession = newState.sessions['gm-override']
          || { hackedLayers: [], hackAttempts: 0, loggedIn: false, keyItemUsed: false, keyItemAttempts: 0, loginAttempts: 0, layerHackAttempts: {}, layerLockoutUntil: null, lockoutUntil: null };
        const allLayers = [];
        const netConfig = config.network ?? {};
        if (netConfig.required ?? config.requiresNetwork) allLayers.push('network');
        if (config.requiresKeyItem) allLayers.push('keyitem');
        if (config.requiresLogin) allLayers.push('login');
        if (config.encrypted) allLayers.push('encryption');
        gmSession.hackedLayers = allLayers;
        if (allLayers.includes('keyitem')) gmSession.keyItemUsed = true;
        if (allLayers.includes('login')) gmSession.loggedIn = true;
        newState.sessions['gm-override'] = gmSession;

        this.app._animationActive = true;
        await item.unsetFlag(MODULE_ID, 'state');
        await item.setFlag(MODULE_ID, 'state', newState);
        this.app._animationActive = false;
        ui.notifications.info(`NCM | Force-decrypted: ${item.name}`);
      } catch (err) {
        this.app._animationActive = false;
        console.error(`${MODULE_ID} | forceDecryptShardItem decrypt failed:`, err);
        ui.notifications.error(`NCM | Force-decrypt failed: ${err.message}`);
      }
    }
    this.render();
  }

  // ─── Integrity ───

  async onSetIntegrity(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    const value = parseInt(target.closest('[data-value]')?.dataset.value);
    if (!itemId || isNaN(value)) return;
    const item = this.app.constructor._findItem(itemId);
    if (!item) return;
    try {
      this.app._animationActive = true;
      const result = await this.dataShardService?.setIntegrity(item, value);
      this.app._animationActive = false;
      if (result?.success) ui.notifications.info(`NCM | ${item.name} integrity set to ${value}%${result.uncorruptedCount ? ` (${result.uncorruptedCount} entries restored)` : ''}`);
      else ui.notifications.warn(`NCM | Set integrity failed: ${result?.error || 'Unknown'}`);
    } catch (err) {
      this.app._animationActive = false;
      console.error(`${MODULE_ID} | setShardIntegrity failed:`, err);
      ui.notifications.error(`NCM | Set integrity failed: ${err.message}`);
    }
    this.render();
  }

  /**
   * Per-entry damage for the selected shard (mechanical mode). Counts come from
   * the same IntegrityModel.applyLoss the viewer renders with, so the GM reads
   * exactly what the player is looking at.
   * @private
   */
  _entryDamage(item, cfg) {
    const entries = this.dataShardService?.getShardMessages?.(item) ?? [];
    const rows = entries.map((e) => {
      const level = entryLevel(e);
      const dmg = level > 0 ? applyLoss(foundry.utils.deepClone(e), level, cfg) : null;
      let lostLabel = '';
      let tag = null;
      if (dmg?.special === 'safe') tag = { cls: 'safe', label: 'Funds protected' };
      else if (dmg?.special === 'glitchy') tag = { cls: 'glitch', label: `Unstable · DV +${cfg.glitchDV}` };
      else if (dmg?.gone) tag = { cls: 'lost', label: 'Entry lost' };
      else if (dmg && (dmg.special === 'text' || dmg.special === 'eb')) lostLabel = `~${dmg.lost}${dmg.unit} lost`;
      else if (dmg?.total) lostLabel = `${dmg.lost} / ${dmg.total} ${dmg.unit} lost`;
      return { entryId: e.id, pct: Math.round(level * 100), lostLabel, tag, hiddenTag: !!dmg?.gone && cfg.hideLost };
    });
    return { rows, damaged: rows.filter(r => r.pct > 0).length, total: rows.length };
  }

  /** Damage button — a hit of N points, optionally rolling data loss like a failed breach. */
  async onDamageShard(event, target) {
    event.stopPropagation();
    const box = target.closest('.ncm-sh2-ig') || target.parentElement;
    const item = this.app.constructor._findItem(target.dataset.itemId || box?.dataset.itemId);
    if (!item) return;
    const amount = Math.max(1, parseInt(box?.querySelector('[data-ig-amount]')?.value) || 0);
    const rollLoss = !!box?.querySelector('[data-ig-roll]')?.classList.contains('is-on');
    this.app._animationActive = true;
    try {
      const res = await this.dataShardService?.degradeIntegrity(item, { amount, rollLoss, by: 'GM' });
      const n = res?.damaged?.length || 0;
      ui.notifications.info(`NCM | ${item.name}: integrity ${res?.newIntegrity ?? '?'}${n ? ` · ${n} entr${n === 1 ? 'y' : 'ies'} damaged` : ''}`);
    } catch (err) {
      ui.notifications.error(`NCM | Damage failed: ${err.message}`);
    } finally {
      this.app._animationActive = false;
    }
    this.render();
  }

  /** The "roll data loss" toggle beside the Damage button — DOM-only. */
  onToggleDamageRoll(event, target) {
    event.stopPropagation();
    const box = target.closest('[data-action="toggleShardDamageRoll"]') || target;
    box.querySelector('[data-ig-roll]')?.classList.toggle('is-on');
  }

  /** A pip (or the wrench) on an entry row — set that entry's damage directly. */
  async onSetEntryDamage(event, target) {
    event.stopPropagation();
    const item = this.app.constructor._findItem(target.closest('[data-item-id]')?.dataset.itemId);
    const entryId = target.closest('[data-entry-id]')?.dataset.entryId;
    if (!item || !entryId) return;
    const lv = (parseInt(target.dataset.lv) || 0) / 4;
    await this.dataShardService?.setEntryCorruption(item, entryId, lv);
    this.render();
  }

  async onRepairAllEntries(event, target) {
    event.stopPropagation();
    const item = this.app.constructor._findItem(target.closest('[data-item-id]')?.dataset.itemId);
    if (!item) return;
    const res = await this.dataShardService?.repairAllEntries(item);
    ui.notifications.info(`NCM | ${item.name}: ${res?.count || 0} entr${res?.count === 1 ? 'y' : 'ies'} repaired.`);
    this.render();
  }

  /** Open the shard at one entry — the player's view of it. */
  onOpenShardEntry(event, target) {
    event.stopPropagation();
    const item = this.app.constructor._findItem(target.closest('[data-item-id]')?.dataset.itemId);
    const entryId = target.closest('[data-entry-id]')?.dataset.entryId;
    if (!item || !game.nightcity?.openDataShard) return;
    game.nightcity.openDataShard(item);
    if (entryId) setTimeout(() => document.getElementById(`shard-entry-${entryId}`)?.scrollIntoView({ block: 'start' }), 600);
  }

  async onRestoreIntegrity(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    const item = itemId ? this.app.constructor._findItem(itemId) : null;
    if (!item) return;
    try {
      this.app._animationActive = true;
      const result = await this.dataShardService?.setIntegrity(item, 100, { uncorrupt: true });
      this.app._animationActive = false;
      if (result?.success) ui.notifications.info(`NCM | ${item.name} integrity fully restored${result.uncorruptedCount ? ` (${result.uncorruptedCount} entries un-corrupted)` : ''}`);
      else ui.notifications.warn(`NCM | Restore failed: ${result?.error || 'Unknown'}`);
    } catch (err) {
      this.app._animationActive = false;
      console.error(`${MODULE_ID} | restoreShardIntegrity failed:`, err);
      ui.notifications.error(`NCM | Restore failed: ${err.message}`);
    }
    this.render();
  }
}
