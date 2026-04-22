/**
 * SpamTab — Spam generator (quick blast, template library, custom creator, auto-spam).
 * @file scripts/ui/AdminPanel/tabs/SpamTab.js
 * @module cyberpunkred-messenger
 *
 * Tab-local state covers recipient selection, category filter, template
 * picker, creator form, and the auto-spam per-network panel. Spam is
 * delivered via SpamService.
 */

import { BaseTab } from '../BaseTab.js';

export class SpamTab extends BaseTab {

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  /** @type {string} Selected category filter */
  _categoryFilter = 'all';
  /** @type {string|null} Currently selected template ID */
  _selectedId = null;
  /** @type {Set<string>} Selected recipient actor IDs */
  _recipients = new Set();
  /** @type {number} Blast count (1-10) */
  _blastCount = 3;
  /** @type {boolean} Show custom creator form */
  _showCreator = false;
  /** @type {string|null} Template ID being edited (null = creating new) */
  _editingId = null;
  /** @type {object} Creator form data */
  _creatorData = { fromName: '', fromEmail: '', category: 'corpo', subject: '', body: '', networkFilter: '' };
  /** @type {boolean} Auto-spam section expanded */
  _autoExpanded = false;
  /** @type {number} Template list scroll position */
  _listScroll = 0;

  get key() { return 'spam'; }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  /**
   * Build the spam tab's context fragment. Merged into the parent's
   * template context on every render.
   */
  prepareContext() {
    const spam = this.spamService;
    if (!spam) {
      return {
        spamPlayerActors: [], spamAllSelected: false, spamBlastCount: 3,
        spamCategoryFilter: 'all', spamCategoryCounts: { all: 0 },
        spamCategoryList: [], spamTemplates: [], spamSelectedTemplate: null,
        spamTotalCount: 0, spamCustomCount: 0, spamSentThisSession: 0,
        spamShowCreator: false, spamEditingId: null, spamCreatorData: this._creatorData,
        spamAutoExpanded: false, spamAutoActiveCount: 0, spamAutoNetworks: [],
      };
    }

    // Player actors with selection state
    const playerActors = spam.getPlayerActors().map(a => ({
      ...a,
      selected: this._recipients.has(a.id),
    }));
    const allSelected = playerActors.length > 0 && playerActors.every(a => a.selected);

    // Category data
    const counts = spam.getCategoryCounts();
    const categories = spam.categories;
    const categoryList = Object.entries(categories).map(([key, cat]) => ({
      key,
      label: cat.label,
      icon: cat.icon,
      color: cat.color,
      count: counts[key] || 0,
      active: this._categoryFilter === key,
    }));

    // Filter templates — 'custom' is a special filter
    let templates;
    if (this._categoryFilter === 'custom') {
      templates = spam.getTemplates().filter(t => t.isCustom);
    } else {
      templates = spam.getTemplates(this._categoryFilter);
    }

    // Enrich templates with display data
    templates = templates.map(t => {
      const cat = categories[t.category] || { icon: 'fas fa-envelope', label: t.category, color: 'muted' };
      return {
        ...t,
        categoryIcon: cat.icon,
        categoryLabel: cat.label,
        categoryColor: cat.color,
        isActive: t.id === this._selectedId,
      };
    });

    // Selected template detail
    let selectedTemplate = null;
    if (this._selectedId) {
      const tmpl = spam.getTemplate(this._selectedId);
      if (tmpl) {
        const cat = categories[tmpl.category] || { icon: 'fas fa-envelope', label: tmpl.category, color: 'muted' };
        // Convert body newlines to <br> for HTML display, and highlight tokens
        let bodyHtml = (tmpl.body || '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>')
          .replace(/\{\{(\w+)\}\}/g, '<span style="color: var(--ncm-accent); font-weight: 700;">{{$1}}</span>');

        selectedTemplate = {
          ...tmpl,
          categoryIcon: cat.icon,
          categoryLabel: cat.label,
          categoryColor: cat.color,
          bodyHtml,
        };
      }
    }

    // Auto-spam network data
    const allNetworks = this.networkService?.getAllNetworks?.() ?? [];
    const autoConfig = spam.getAutoConfig();
    const autoNetworks = allNetworks.map(net => {
      const cfg = autoConfig[net.id] ?? {};
      return {
        id: net.id,
        name: net.name,
        enabled: cfg.enabled ?? false,
        volume: cfg.volume ?? 'low',
      };
    });

    return {
      spamPlayerActors: playerActors,
      spamAllSelected: allSelected,
      spamBlastCount: this._blastCount,
      spamCategoryFilter: this._categoryFilter,
      spamCategoryCounts: counts,
      spamCategoryList: categoryList,
      spamTemplates: templates,
      spamSelectedTemplate: selectedTemplate,
      spamTotalCount: spam.totalCount,
      spamCustomCount: spam.customCount,
      spamSentThisSession: spam.sentThisSession,
      spamShowCreator: this._showCreator,
      spamEditingId: this._editingId,
      spamCreatorData: this._creatorData,
      spamAutoExpanded: this._autoExpanded,
      spamAutoActiveCount: spam.activeAutoSpamCount,
      spamAutoNetworks: autoNetworks,
    };
  }

  /**
   * Post-render DOM wire-up — restore scroll, attach change listeners
   * for auto-spam volume selects and the creator form inputs/selects.
   */
  onRender(context, options) {
    // Restore spam library list scroll position
    const listEl = this.element?.querySelector('.ncm-spam-lib__list');
    if (listEl && this._listScroll) {
      listEl.scrollTop = this._listScroll;
    }

    // Auto-spam volume selects (data-action on <select> fires on click, not change)
    const volSelects = this.element?.querySelectorAll('.ncm-spam-auto-row__vol-select') ?? [];
    for (const sel of volSelects) {
      sel.addEventListener('change', async (e) => {
        const networkId = e.target.dataset.networkId;
        const volume = e.target.value;
        if (networkId && this.spamService) {
          await this.spamService.setNetworkVolume(networkId, volume);
        }
      });
    }

    // Creator form selects
    const creatorSelects = this.element?.querySelectorAll('.ncm-spam-creator__select') ?? [];
    for (const sel of creatorSelects) {
      sel.addEventListener('change', (e) => {
        const field = e.target.dataset.field;
        if (field) this._creatorData[field] = e.target.value;
      });
    }

    // Creator form inputs (live capture for preservation across renders)
    const creatorInputs = this.element?.querySelectorAll('.ncm-spam-creator__input, .ncm-spam-creator__textarea') ?? [];
    for (const inp of creatorInputs) {
      inp.addEventListener('input', (e) => {
        const field = e.target.dataset.field;
        if (field) this._creatorData[field] = e.target.value;
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Private Helpers
  // ═══════════════════════════════════════════════════════════

  _saveListScroll() {
    const listEl = this.element?.querySelector('.ncm-spam-lib__list');
    if (listEl) this._listScroll = listEl.scrollTop;
  }

  _getRecipientIds() {
    return [...this._recipients];
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers
  // ═══════════════════════════════════════════════════════════

  onToggleAll(event, target) {
    const actors = this.spamService?.getPlayerActors() ?? [];
    const allSelected = actors.length > 0 && actors.every(a => this._recipients.has(a.id));
    if (allSelected) {
      this._recipients.clear();
    } else {
      for (const a of actors) this._recipients.add(a.id);
    }
    this._saveListScroll();
    this.render(true);
  }

  onToggleRecipient(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;
    if (this._recipients.has(actorId)) {
      this._recipients.delete(actorId);
    } else {
      this._recipients.add(actorId);
    }
    this._saveListScroll();
    this.render(true);
  }

  onCountUp(event, target) {
    if (this._blastCount < 10) {
      this._blastCount++;
      this._saveListScroll();
      this.render(true);
    }
  }

  onCountDown(event, target) {
    if (this._blastCount > 1) {
      this._blastCount--;
      this._saveListScroll();
      this.render(true);
    }
  }

  async onBlast(event, target) {
    const recipients = this._getRecipientIds();
    if (recipients.length === 0) {
      ui.notifications.warn('Select at least one recipient.');
      return;
    }
    this._saveListScroll();
    const result = await this.spamService?.blast(recipients, this._blastCount, this._categoryFilter);
    if (result?.sent > 0) {
      ui.notifications.info(`Blasted ${result.sent} spam message(s).`);
    }
    this.render(true);
  }

  onFilterCategory(event, target) {
    const category = target.closest('[data-category]')?.dataset.category;
    if (!category) return;
    this._categoryFilter = category;
    this._selectedId = null; // Clear selection on category change
    this.render(true);
  }

  onSelectTemplate(event, target) {
    const templateId = target.closest('[data-template-id]')?.dataset.templateId;
    if (!templateId) return;
    this._selectedId = this._selectedId === templateId ? null : templateId;
    this._saveListScroll();
    this.render(true);
  }

  async onSendTemplate(event, target) {
    const templateId = target.closest('[data-template-id]')?.dataset.templateId;
    if (!templateId) return;
    const recipients = this._getRecipientIds();
    if (recipients.length === 0) {
      ui.notifications.warn('Select at least one recipient.');
      return;
    }
    this._saveListScroll();
    const result = await this.spamService?.sendTemplate(templateId, recipients);
    if (result?.sent > 0) {
      ui.notifications.info(`Sent spam to ${result.sent} recipient(s).`);
    }
    this.render(true);
  }

  onToggleCreator(event, target) {
    this._showCreator = !this._showCreator;
    if (!this._showCreator) {
      this._editingId = null;
      this._creatorData = { fromName: '', fromEmail: '', category: 'corpo', subject: '', body: '', networkFilter: '' };
    }
    this.render(true);
  }

  onCancelCreator(event, target) {
    this._showCreator = false;
    this._editingId = null;
    this._creatorData = { fromName: '', fromEmail: '', category: 'corpo', subject: '', body: '', networkFilter: '' };
    this.render(true);
  }

  async onSaveTemplate(event, target) {
    // Read current form values from DOM (in case input events didn't fire)
    const form = this.element;
    const fields = ['fromName', 'fromEmail', 'subject', 'body', 'category', 'networkFilter'];
    for (const f of fields) {
      const el = form?.querySelector(`[data-field="${f}"]`);
      if (el) this._creatorData[f] = el.value ?? '';
    }

    if (!this._creatorData.fromName || !this._creatorData.subject) {
      ui.notifications.warn('From Name and Subject are required.');
      return;
    }

    if (this._editingId) {
      await this.spamService?.updateTemplate(this._editingId, this._creatorData);
      ui.notifications.info('Template updated.');
    } else {
      await this.spamService?.createTemplate(this._creatorData);
      ui.notifications.info('Custom template created.');
    }

    this._showCreator = false;
    this._editingId = null;
    this._creatorData = { fromName: '', fromEmail: '', category: 'corpo', subject: '', body: '', networkFilter: '' };
    this.render(true);
  }

  onEditTemplate(event, target) {
    const templateId = target.closest('[data-template-id]')?.dataset.templateId;
    if (!templateId) return;
    const tmpl = this.spamService?.getTemplate(templateId);
    if (!tmpl || !tmpl.isCustom) return;

    this._editingId = templateId;
    this._creatorData = {
      fromName: tmpl.fromName || '',
      fromEmail: tmpl.fromEmail || '',
      category: tmpl.category || 'corpo',
      subject: tmpl.subject || '',
      body: tmpl.body || '',
      networkFilter: tmpl.networkFilter || '',
    };
    this._showCreator = true;
    this.render(true);
  }

  async onDeleteTemplate(event, target) {
    const templateId = target.closest('[data-template-id]')?.dataset.templateId;
    if (!templateId) return;

    const confirm = await Dialog.confirm({
      title: 'Delete Template',
      content: '<p>Permanently delete this custom spam template?</p>',
    });
    if (!confirm) return;

    await this.spamService?.deleteTemplate(templateId);
    if (this._selectedId === templateId) this._selectedId = null;
    ui.notifications.info('Template deleted.');
    this.render(true);
  }

  onToggleAutoSection(event, target) {
    this._autoExpanded = !this._autoExpanded;
    this.render(true);
  }

  async onToggleAutoNetwork(event, target) {
    const networkId = target.closest('[data-network-id]')?.dataset.networkId;
    if (!networkId) return;
    await this.spamService?.toggleNetworkAutoSpam(networkId);
    this.render(true);
  }
}
