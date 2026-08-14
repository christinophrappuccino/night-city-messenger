/**
 * TerminalsTab — Admin Panel tab for Terminal management.
 * @file scripts/ui/AdminPanel/tabs/TerminalsTab.js
 * @module cyberpunkred-messenger
 *
 * Enumerates every Terminal (world + actor-owned), shows accounts / current
 * logins / network binding / lock state, and offers per-terminal management:
 * open, configure, force-unlock, relock, remove, plus Import Item → Terminal.
 * Mirrors ShardsTab. Action handlers are static on AdminPanelApp delegating to
 * the matching onXyz here.
 */

import { BaseTab } from '../BaseTab.js';
import { MODULE_ID } from '../../../utils/constants.js';

export class TerminalsTab extends BaseTab {

  _search = '';

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
      const netReq = cfg.network?.required
        ? ((cfg.network.allowedNetworks || [])[0] || 'any network')
        : null;
      const secured = accounts.some(a => a.security?.requiresAuth);
      return {
        id: item.id,
        name: cfg.terminalName || item.name,
        img: item.img,
        owner: cfg.metadata?.owner || '',
        org: cfg.metadata?.org || '',
        scope: item.parent ? item.parent.name : 'World',
        accountCount: accounts.length,
        logins,
        loginCount: logins.length,
        networkBinding: netReq,
        gmBypassed: !!state.gmBypassed,
        locked: secured && !state.gmBypassed,
        preset: cfg.theme?.preset || '',
      };
    });

    const q = this._search.trim().toLowerCase();
    const terminals = q
      ? all.filter(t => `${t.name} ${t.owner} ${t.org}`.toLowerCase().includes(q))
      : all;

    return {
      terminals,
      terminalCount: all.length,
      terminalSearch: this._search,
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
      search.addEventListener('input', (e) => {
        this._search = e.target.value;
        this.app.render(false);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Actions (called from AdminPanelApp static delegators)
  // ═══════════════════════════════════════════════════════════

  _resolve(target) {
    const id = target?.dataset?.itemId;
    if (!id) return null;
    return (this.terminalService?.collectTerminals?.() ?? []).find(it => it.id === id) || null;
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

  async onRelock(event, target) {
    const item = this._resolve(target);
    if (!item) return;
    const ok = await Dialog.confirm({ title: 'Relock Terminal', content: `<p>Wipe all sessions and reset lockouts for <strong>${item.name}</strong>?</p>` });
    if (!ok) return;
    await this.terminalService.relock(item);
    this.app.render(false);
  }

  async onRemove(event, target) {
    const item = this._resolve(target);
    if (!item) return;
    const ok = await Dialog.confirm({ title: 'Remove Terminal Data', content: `<p>Revert <strong>${item.name}</strong> to a plain item? Accounts/config are lost (the message journal is kept).</p>` });
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
      new Dialog({
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
    const { TerminalConfigApp } = await import('../../Terminal/TerminalConfigApp.js');
    new TerminalConfigApp({ item }).render(true);
    this.app.render(false);
  }
}
