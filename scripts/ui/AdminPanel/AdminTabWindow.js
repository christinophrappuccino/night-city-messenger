/**
 * AdminTabWindow — one Admin Panel tab in its own, larger window ("Pop out").
 * @file scripts/ui/AdminPanel/AdminTabWindow.js
 * @module night-city-messenger
 *
 * The 2026-10-27 admin redesign folds the GM Contact Manager and the Network
 * Manager into their tabs (edit in place). For a GM who wants more room — a
 * scene beside it, a second screen — the tab pops out into this window. It IS
 * the Admin Panel (same class, same templates, same tab controllers), pinned to
 * one tab with the panel chrome hidden, so the two can never drift apart.
 *
 * One window per tab, keyed by id `ncm-admin-pop-<tab>` (AdminPanelApp.openTabWindow).
 * Tabs read `this.app.isPopout` to widen their layout (CSS hook: the root
 * carries `.ncm-admin-panel--pop`). "Back to the admin panel" = action dockTab.
 */

import { AdminPanelApp } from './AdminPanelApp.js';

const TITLES = {
  overview: 'Overview', messages: 'Messages', contacts: 'Contacts', networks: 'Networks',
  shards: 'Shards', terminals: 'Terminals', access: 'Access points', security: 'Security', spam: 'Spam', tools: 'Tools',
};

export class AdminTabWindow extends AdminPanelApp {

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    classes: ['ncm-app', 'ncm-admin-panel', 'ncm-admin-panel--pop'],
    window: { title: 'Admin', icon: 'fas fa-up-right-from-square', resizable: true, minimizable: true },
    position: { width: 1120, height: 780 },
  }, { inplace: false });

  /** @param {object} options — { id, popTab } */
  constructor(options = {}) {
    super(options);
    this._activeTab = options.popTab || 'overview';
  }

  get isPopout() { return true; }

  get title() { return TITLES[this._activeTab] || 'Admin'; }
}

export default AdminTabWindow;
