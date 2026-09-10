/**
 * TerminalsTab — Admin Panel tab for Terminal management.
 * @file scripts/ui/AdminPanel/tabs/TerminalsTab.js
 * @module night-city-messenger
 *
 * Split-panel manager (dev-picked 2026-07-11, the NetworkManagement-Scenes
 * pattern): summary strip on top, then a searchable / sortable / filterable /
 * paginated terminal LIST on the left and the SELECTED terminal's full detail
 * on the right — identity, uplink, accounts with lock badges, live sessions,
 * and every action (Open / Configure / Force-unlock / Reset / Export /
 * Remove). "Reset" is `TerminalService.relock` — it already wipes sessions,
 * lockouts, GM bypass, and returns the uplink to its default.
 * Action handlers are static on AdminPanelApp delegating to onXyz here;
 * the search input and sort <select> get manual listeners in onRender
 * (selects don't fire reliably via data-action — standing gotcha).
 */

import { BaseTab } from '../BaseTab.js';
import { MODULE_ID } from '../../../utils/constants.js';
import { adminDialog, adminConfirm } from '../../../utils/adminTheme.js';

export class TerminalsTab extends BaseTab {

  static PAGE_SIZE = 10;

  _search = '';
  _sort = 'name';       // name | accounts | online | preset
  _filter = 'all';      // all | online | locked
  _page = 1;
  _selectedId = null;

  get key() { return 'terminals'; }
  get terminalService() { return game.nightcity?.terminalService; }

  // ═══════════════════════════════════════════════════════════
  //  Context
  // ═══════════════════════════════════════════════════════════

  prepareContext() {
    const svc = this.terminalService;
    const all = (svc?.collectTerminals?.() ?? []).map(item => {
      const cfg = svc.getConfig(item);
      const state = svc.getState(item);
      const accounts = cfg.accounts || [];
      const sessions = state.sessions || {};
      const logins = Object.entries(sessions)
        .filter(([, s]) => s && s.activeAccountId)
        .map(([actorId, s]) => ({
          actor: game.actors?.get(actorId)?.name || actorId,
          account: accounts.find(a => a.id === s.activeAccountId)?.username || s.activeAccountId,
        }));
      const secured = accounts.some(a => a.security?.requiresAuth);
      let uplinkName = null;
      try { uplinkName = svc.getUplink(item)?.network?.name || null; } catch { /* older items */ }
      return {
        id: item.id,
        name: cfg.terminalName || item.name,
        img: item.img,
        owner: cfg.metadata?.owner || '',
        org: cfg.metadata?.org || '',
        location: cfg.metadata?.location || '',
        classification: cfg.metadata?.classification || '',
        scope: item.parent ? item.parent.name : 'World',
        accountCount: accounts.length,
        adminCount: accounts.filter(a => a.isAdmin).length,
        hiddenCount: accounts.filter(a => a.hidden).length,
        accounts: accounts.map(a => ({
          id: a.id, username: a.username, displayName: a.displayName || a.username,
          isAdmin: !!a.isAdmin, hidden: !!a.hidden,
          netGated: !!a.network?.restricted,
          open: !a.security?.requiresAuth,
        })),
        logins,
        loginCount: logins.length,
        // Login footprints (terminalState.loginLog) — newest first, last 6.
        recentLogins: (svc.getLoginLog?.(item) || []).slice(-6).reverse().map(e => ({
          when: e.ts ? this.app._relativeTime(e.ts) : '',
          account: e.username || e.accountId,
          operator: e.operatorName || '',
        })),
        networkBinding: cfg.network?.required ? ((cfg.network.allowedNetworks || [])[0] || 'any network') : null,
        uplinkName,
        allowExfil: cfg.allowExfil !== false,
        gmBypassed: !!state.gmBypassed,
        locked: secured && !state.gmBypassed,
        preset: cfg.theme?.preset || 'classic',
        loginStyle: cfg.loginStyle || 'cards',
        soundSet: cfg.soundSet || 'default',
      };
    });

    // ── Filter → search → sort (list controls act on the full set) ──
    let list = all;
    if (this._filter === 'online') list = list.filter(t => t.loginCount > 0);
    else if (this._filter === 'locked') list = list.filter(t => t.locked);
    const q = this._search.trim().toLowerCase();
    if (q) {
      list = list.filter(t =>
        `${t.name} ${t.owner} ${t.org} ${t.location} ${t.preset} ${t.scope} ${t.accounts.map(a => a.username).join(' ')}`
          .toLowerCase().includes(q));
    }
    const by = {
      name: (a, b) => a.name.localeCompare(b.name),
      accounts: (a, b) => b.accountCount - a.accountCount || a.name.localeCompare(b.name),
      online: (a, b) => b.loginCount - a.loginCount || a.name.localeCompare(b.name),
      preset: (a, b) => a.preset.localeCompare(b.preset) || a.name.localeCompare(b.name),
    };
    list = [...list].sort(by[this._sort] || by.name);

    // ── Pagination (clamp on shrink) ──
    const maxPage = Math.max(1, Math.ceil(list.length / TerminalsTab.PAGE_SIZE));
    if (this._page > maxPage) this._page = maxPage;
    const pageRows = list.slice((this._page - 1) * TerminalsTab.PAGE_SIZE, this._page * TerminalsTab.PAGE_SIZE);

    // ── Selection: keep if still in the filtered list, else first visible ──
    if (!list.some(t => t.id === this._selectedId)) this._selectedId = pageRows[0]?.id ?? null;
    const selected = all.find(t => t.id === this._selectedId) || null;

    return {
      terminals: pageRows.map(t => ({ ...t, isSelected: t.id === this._selectedId })),
      terminalCount: all.length,
      terminalListCount: list.length,
      terminalSelected: selected,
      terminalSearch: this._search,
      terminalSort: this._sort,
      terminalSortOptions: [
        { value: 'name', label: 'Name', selected: this._sort === 'name' },
        { value: 'accounts', label: 'Most accounts', selected: this._sort === 'accounts' },
        { value: 'online', label: 'Online first', selected: this._sort === 'online' },
        { value: 'preset', label: 'Preset', selected: this._sort === 'preset' },
      ],
      terminalFilter: this._filter,
      terminalFilters: [
        { value: 'all', label: 'All', active: this._filter === 'all' },
        { value: 'online', label: 'Online', active: this._filter === 'online' },
        { value: 'locked', label: 'Locked', active: this._filter === 'locked' },
      ],
      terminalPagination: maxPage > 1 ? {
        page: this._page, maxPage,
        hasPrev: this._page > 1, hasNext: this._page < maxPage,
      } : null,
      terminalSummary: {
        total: all.length,
        accounts: all.reduce((n, t) => n + t.accountCount, 0),
        logins: all.reduce((n, t) => n + t.loginCount, 0),
        locked: all.filter(t => t.locked).length,
      },
    };
  }

  onRender() {
    const el = this.app.element;
    const search = el?.querySelector('[data-terminal-search]');
    if (search && !search.dataset.wired) {
      search.dataset.wired = '1';
      search.addEventListener('input', foundry.utils.debounce((e) => {
        this._search = e.target.value;
        this._page = 1;
        this.app._saveScroll?.();
        this.app.render(false);
      }, 200));
    }
    const sort = el?.querySelector('[data-terminal-sort]');
    if (sort && !sort.dataset.wired) {
      sort.dataset.wired = '1';
      sort.addEventListener('change', (e) => {
        this._sort = e.target.value;
        this._page = 1;
        this.app.render(false);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Actions (called from AdminPanelApp static delegators)
  // ═══════════════════════════════════════════════════════════

  _resolve(target) {
    const id = target?.dataset?.itemId || target?.closest?.('[data-item-id]')?.dataset.itemId || this._selectedId;
    if (!id) return null;
    return (this.terminalService?.collectTerminals?.() ?? []).find(it => it.id === id) || null;
  }

  onSelect(event, target) {
    const id = target?.closest?.('[data-item-id]')?.dataset.itemId;
    if (!id || id === this._selectedId) return;
    this._selectedId = id;
    this.app.render(false);
  }

  onFilter(event, target) {
    const f = target?.dataset?.filter;
    if (!f || f === this._filter) return;
    this._filter = f;
    this._page = 1;
    this.app.render(false);
  }

  onPage(event, target) {
    const dir = target?.dataset?.dir;
    this._page = Math.max(1, this._page + (dir === 'next' ? 1 : -1));
    this.app.render(false);
  }

  onOpen(event, target) {
    const item = this._resolve(target);
    if (item) game.nightcity?.openTerminal?.(item);
  }

  async onConfigure(event, target) {
    const item = this._resolve(target);
    if (!item) return;
    const { TerminalConfigApp } = await import('../../Terminal/TerminalConfigApp.js');
    new TerminalConfigApp({ item }).render(true);
  }

  async onForceUnlock(event, target) {
    const item = this._resolve(target);
    if (!item) return;
    await this.terminalService.forceUnlock(item);
    this.app.render(false);
  }

  /** Reset = relock: log everyone out, clear lockouts + GM bypass, uplink → default. */
  async onRelock(event, target) {
    const item = this._resolve(target);
    if (!item) return;
    const ok = await adminConfirm({
      title: 'Reset Terminal',
      content: `<p>Reset <strong>${Handlebars.escapeExpression(item.name)}</strong>? Everyone is logged out; lockouts, GM bypass, and the machine's uplink return to defaults. Config, accounts, and messages are untouched.</p>`,
    });
    if (!ok) return;
    await this.terminalService.relock(item);
    ui.notifications.info(`"${item.name}" reset — all sessions cleared.`);
    this.app.render(false);
  }

  /** Export the terminal's full config as JSON (the config-sheet envelope). */
  onExport(event, target) {
    const item = this._resolve(target);
    if (!item) return;
    const cfg = this.terminalService.getConfig(item);
    const payload = { ncmTerminal: 1, name: item.name, exportedAt: new Date().toISOString(), config: cfg };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-terminal-${(item.name || 'terminal').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info(`Exported "${item.name}" config.`);
  }

  async onRemove(event, target) {
    const item = this._resolve(target);
    if (!item) return;
    const ok = await adminConfirm({ title: 'Remove Terminal Data', content: `<p>Revert <strong>${Handlebars.escapeExpression(item.name)}</strong> to a plain item? Accounts/config are lost (the message journal is kept).</p>` });
    if (!ok) return;
    await this.terminalService.removeTerminal(item);
    this.app.render(false);
  }

  /** Import Item → Terminal: pick a non-converted item, convert, open config. */
  async onImport() {
    const svc = this.terminalService;
    const candidates = game.items.filter(i =>
      !i.getFlag(MODULE_ID, 'isTerminal') && !i.getFlag(MODULE_ID, 'isDataShard'));
    if (!candidates.length) return ui.notifications.warn('No eligible world items to convert.');
    const options = candidates.map(i => `<option value="${i.id}">${Handlebars.escapeExpression(i.name)}</option>`).join('');
    let pickedId = null;
    await new Promise((resolve) => {
      adminDialog({
        title: 'Import Item → Terminal',
        content: `<p>Convert which world item into a Terminal?</p><select style="width:100%">${options}</select>`,
        buttons: {
          convert: { label: 'Convert', callback: (html) => { pickedId = html.find('select').val(); } },
          cancel: { label: 'Cancel' },
        },
        default: 'convert', close: () => resolve(),
      }).render(true);
    });
    if (!pickedId) return;
    const item = game.items.get(pickedId);
    const res = await svc.convertToTerminal(item);
    if (!res?.success) return ui.notifications.error(res?.error || 'Conversion failed.');
    ui.notifications.info(`"${item.name}" is now a Terminal.`);
    this._selectedId = item.id;
    const { TerminalConfigApp } = await import('../../Terminal/TerminalConfigApp.js');
    new TerminalConfigApp({ item }).render(true);
    this.app.render(false);
  }
}
