/**
 * BaseTab — Abstract controller for a single AdminPanel tab.
 * @file scripts/ui/AdminPanel/BaseTab.js
 * @module cyberpunkred-messenger
 *
 * AdminPanelApp is a single ApplicationV2 window with 7 tabs. Each tab's
 * state, data gathering, DOM wire-up, and action handling lives in a
 * subclass of BaseTab. AdminPanelApp holds instances of every tab in
 * this.tabs and delegates to them.
 *
 * Action handlers remain static on AdminPanelApp (ApplicationV2 binds
 * them at class-load time). Each static handler forwards to the
 * matching tab method, e.g.:
 *
 *   static _onContactFilter(event, target) {
 *     this.tabs.contacts.onContactFilter(event, target);
 *   }
 *
 * Subclasses should override key, prepareContext, onRender, onClose as
 * needed. Action-handler methods are named by convention (onXyz) and
 * called directly from the parent's static delegators — there is no
 * automatic dispatch layer.
 */

export class BaseTab {

  /**
   * @param {import('./AdminPanelApp.js').AdminPanelApp} app — Parent panel instance
   */
  constructor(app) {
    this.app = app;
  }

  /**
   * Unique tab key matching the activeTab string and data-tab attribute.
   * @returns {string}
   */
  get key() {
    throw new Error(`${this.constructor.name}: must override get key()`);
  }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  /**
   * Produce the template-context fragment for this tab. Called every
   * render; return object is spread into the parent's context.
   * @param {object} sharedContext — Shared data already gathered by the parent (stats, etc.)
   * @returns {Promise<object>|object}
   */
  async prepareContext(sharedContext) {
    return {};
  }

  /**
   * Post-render DOM wire-up specific to this tab. Called after every
   * render. Parent calls this only when this tab is the active one.
   * @param {object} context
   * @param {object} options
   */
  onRender(context, options) {}

  /**
   * Cleanup hook called when the parent app closes. Clear intervals,
   * remove per-tab listeners, release timers.
   */
  onClose() {}

  // ═══════════════════════════════════════════════════════════
  //  Convenience Accessors (proxy to parent)
  // ═══════════════════════════════════════════════════════════

  get element()           { return this.app.element; }
  get eventBus()          { return this.app.eventBus; }
  get stateManager()      { return this.app.stateManager; }
  get settingsManager()   { return this.app.settingsManager; }
  get themeService()      { return this.app.themeService; }
  get soundService()      { return this.app.soundService; }
  get messageService()    { return this.app.messageService; }
  get schedulingService() { return this.app.schedulingService; }
  get networkService()    { return this.app.networkService; }
  get masterContactService() { return this.app.masterContactService; }
  get messageRepository() { return this.app.messageRepository; }
  get dataShardService()  { return this.app.dataShardService; }
  get contactRepository() { return this.app.contactRepository; }
  get accessLogService()  { return this.app.accessLogService; }
  get spamService()       { return this.app.spamService; }

  /**
   * Re-render the parent panel. Matches ApplicationV2.render() — direct,
   * unguarded. Use for user-triggered refreshes (button clicks, etc.).
   * For bursty event-driven updates use debouncedRender() instead.
   * @param {boolean} [force=false] — Pass true for a full template re-render
   */
  render(force = false) {
    this.app.render(force);
  }

  /**
   * Debounced re-render — coalesces rapid event-driven updates.
   */
  debouncedRender() {
    this.app._debouncedRender();
  }
}
