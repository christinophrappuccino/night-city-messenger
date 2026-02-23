/**
 * Message Composer Application
 * @file scripts/ui/MessageComposer/MessageComposerApp.js
 * @module cyberpunkred-messenger
 * @description Compose, reply, and forward message dialog with recipient
 * autocomplete lookup, priority selector, and network info display.
 */

import { MODULE_ID, EVENTS } from '../../utils/constants.js';

export class MessageComposerApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {

  // ─── Static Configuration ─────────────────────────────────

  static DEFAULT_OPTIONS = {
    id: 'ncm-message-composer-{id}',
    classes: ['ncm-app', 'ncm-message-composer'],
    tag: 'div',
    window: {
      title: 'Compose Message',
      icon: 'fas fa-pen',
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 550,
      height: 480,
    },
    actions: {
      send: MessageComposerApp._onSend,
      cancel: MessageComposerApp._onCancel,
      selectRecipient: MessageComposerApp._onSelectRecipient,
      clearRecipient: MessageComposerApp._onClearRecipient,
      setPriority: MessageComposerApp._onSetPriority,
    },
  };

  static PARTS = {
    composer: {
      template: `modules/${MODULE_ID}/templates/message-composer/message-composer.hbs`,
    },
  };

  // ─── Instance State ───────────────────────────────────────

  /** @type {string} Mode: 'compose' | 'reply' | 'forward' */
  mode = 'compose';

  /** @type {string|null} From actor ID */
  fromActorId = null;

  /** @type {string|null} To actor ID */
  toActorId = null;

  /** @type {string} Subject */
  subject = '';

  /** @type {string} Body */
  body = '';

  /** @type {string} Priority */
  priority = 'normal';

  /** @type {Object|null} Original message (for reply/forward) */
  originalMessage = null;

  /** @type {string|null} Thread ID (for reply) */
  threadId = null;

  /** @type {string|null} In-reply-to message ID */
  inReplyTo = null;

  /** @type {boolean} Sending in progress */
  _sending = false;

  /** @type {Array} Autocomplete search results */
  _searchResults = [];

  // ─── Service Accessors ────────────────────────────────────

  get messageService() { return game.nightcity.messageService; }
  get contactRepo() { return game.nightcity.contactRepository; }
  get soundService() { return game.nightcity.soundService; }
  get eventBus() { return game.nightcity.eventBus; }

  // ─── Constructor ──────────────────────────────────────────

  constructor(options = {}) {
    // Unique ID per instance
    const instanceId = foundry.utils.randomID(8);
    super(foundry.utils.mergeObject(options, {
      id: `ncm-message-composer-${instanceId}`,
    }));

    this.mode = options.mode || 'compose';
    this.fromActorId = options.fromActorId || this._getDefaultFromActor();
    this.originalMessage = options.originalMessage || null;

    // Populate fields based on mode
    if (this.mode === 'reply' && this.originalMessage) {
      const reply = this.messageService.buildReply(this.originalMessage, this.fromActorId, '');
      this.toActorId = reply.toActorId;
      this.subject = reply.subject;
      this.threadId = reply.threadId;
      this.inReplyTo = reply.inReplyTo;
    } else if (this.mode === 'forward' && this.originalMessage) {
      const fwd = this.messageService.buildForward(this.originalMessage, this.fromActorId, '', '');
      this.subject = fwd.subject;
      this.body = fwd.body;
    } else {
      // New compose
      this.toActorId = options.toActorId || null;
      this.subject = options.subject || '';
      this.body = options.body || '';
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────

  async _prepareContext(options) {
    // Get owned actors for FROM dropdown
    const ownedActors = this.contactRepo?.getOwnedActorsWithEmail() || [];

    // Get recipient info
    let toActor = null;
    let toEmail = '';
    if (this.toActorId) {
      const actor = game.actors.get(this.toActorId);
      if (actor) {
        toActor = { id: actor.id, name: actor.name, img: actor.img };
        toEmail = this.contactRepo?.getActorEmail(this.toActorId) || '';
      }
    }

    // From actor info
    const fromActor = game.actors.get(this.fromActorId);

    return {
      mode: this.mode,
      modeLabel: this.mode === 'reply' ? 'Reply' : this.mode === 'forward' ? 'Forward' : 'Compose',

      fromActorId: this.fromActorId,
      fromName: fromActor?.name || '',
      fromEmail: this.contactRepo?.getActorEmail(this.fromActorId) || '',
      ownedActors,

      toActorId: this.toActorId,
      toActor,
      toEmail,

      subject: this.subject,
      body: this.body,
      priority: this.priority,

      priorities: [
        { id: 'normal', label: 'Normal', active: this.priority === 'normal' },
        { id: 'urgent', label: 'Urgent', active: this.priority === 'urgent' },
        { id: 'critical', label: 'Critical', active: this.priority === 'critical' },
      ],

      searchResults: this._searchResults,
      sending: this._sending,
      isReplyOrForward: this.mode === 'reply' || this.mode === 'forward',
      isGM: game.user.isGM,
      MODULE_ID,
    };
  }

  _onRender(context, options) {
    this._setupRecipientSearch();
    this._setupFromSelector();
    this._setupFormSync();
  }

  // ─── Action Handlers ──────────────────────────────────────

  static async _onSend(event, target) {
    if (this._sending) return;

    // Sync form data
    this._syncFormData();

    // Validate
    if (!this.toActorId) {
      ui.notifications.warn('Please select a recipient.');
      return;
    }
    if (!this.subject.trim() && !this.body.trim()) {
      ui.notifications.warn('Message must have a subject or body.');
      return;
    }

    this._sending = true;
    this.render();

    try {
      const messageData = {
        toActorId: this.toActorId,
        fromActorId: this.fromActorId,
        subject: this.subject,
        body: this.body,
        priority: this.priority,
        threadId: this.threadId,
        inReplyTo: this.inReplyTo,
      };

      const result = await this.messageService.sendMessage(messageData);

      if (result.success) {
        ui.notifications.info(result.queued ? 'Message queued for delivery.' : 'Message sent.');
        this.soundService?.play('send');
        this.close();
      } else {
        ui.notifications.error(`Send failed: ${result.error}`);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Send failed:`, error);
      ui.notifications.error('Failed to send message.');
    } finally {
      this._sending = false;
    }
  }

  static _onCancel(event, target) {
    this.close();
  }

  static _onSelectRecipient(event, target) {
    const actorId = target.dataset.actorId;
    if (!actorId) return;

    this.toActorId = actorId;
    this._searchResults = [];
    this.render();
  }

  static _onClearRecipient(event, target) {
    this.toActorId = null;
    this._searchResults = [];
    this.render();
  }

  static _onSetPriority(event, target) {
    const priority = target.dataset.priority;
    if (priority) {
      this.priority = priority;
      this.render();
    }
  }

  // ─── Recipient Search ─────────────────────────────────────

  _setupRecipientSearch() {
    const searchInput = this.element?.querySelector('.ncm-recipient-search');
    if (!searchInput) return;

    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this._searchRecipients(e.target.value);
      }, 200);
    });

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
      if (!this.element?.contains(e.target)) {
        this._searchResults = [];
        this._renderSearchResults();
      }
    }, { once: true });
  }

  async _searchRecipients(query) {
    if (!query || query.length < 1) {
      this._searchResults = [];
      this._renderSearchResults();
      return;
    }

    // Search global actor directory
    const directory = this.contactRepo?.getGlobalActorDirectory() || [];
    const q = query.toLowerCase();

    this._searchResults = directory.filter(a =>
      a.name?.toLowerCase().includes(q) ||
      a.email?.toLowerCase().includes(q)
    ).slice(0, 8);

    // Also search contacts for the from actor
    if (this.fromActorId) {
      const contacts = await this.contactRepo?.searchContacts(this.fromActorId, query) || [];
      for (const contact of contacts) {
        if (contact.actorId && !this._searchResults.find(r => r.actorId === contact.actorId)) {
          this._searchResults.push({
            actorId: contact.actorId,
            name: contact.name,
            email: contact.email,
            img: contact.customImg || 'icons/svg/mystery-man.svg',
          });
        }
      }
    }

    this._renderSearchResults();
  }

  _renderSearchResults() {
    const dropdown = this.element?.querySelector('.ncm-recipient-dropdown');
    if (!dropdown) return;

    if (this._searchResults.length === 0) {
      dropdown.innerHTML = '';
      dropdown.style.display = 'none';
      return;
    }

    dropdown.style.display = 'block';
    dropdown.innerHTML = this._searchResults.map(r => `
      <div class="ncm-recipient-option" data-action="selectRecipient" data-actor-id="${r.actorId}">
        <img src="${r.img || 'icons/svg/mystery-man.svg'}" class="ncm-recipient-option__img" alt="">
        <div class="ncm-recipient-option__info">
          <span class="ncm-recipient-option__name">${r.name}</span>
          <span class="ncm-recipient-option__email">${r.email}</span>
        </div>
      </div>
    `).join('');
  }

  // ─── Form Management ──────────────────────────────────────

  _setupFromSelector() {
    const fromSelect = this.element?.querySelector('.ncm-from-select');
    if (!fromSelect) return;

    fromSelect.addEventListener('change', (e) => {
      this.fromActorId = e.target.value;
    });
  }

  _setupFormSync() {
    // Sync textarea and input values on change
    const subjectInput = this.element?.querySelector('[name="subject"]');
    const bodyTextarea = this.element?.querySelector('[name="body"]');

    if (subjectInput) {
      subjectInput.value = this.subject;
      subjectInput.addEventListener('input', (e) => { this.subject = e.target.value; });
    }
    if (bodyTextarea) {
      bodyTextarea.value = this.body;
      bodyTextarea.addEventListener('input', (e) => { this.body = e.target.value; });
    }
  }

  _syncFormData() {
    const el = this.element;
    if (!el) return;

    const subject = el.querySelector('[name="subject"]');
    const body = el.querySelector('[name="body"]');
    const from = el.querySelector('.ncm-from-select');

    if (subject) this.subject = subject.value;
    if (body) this.body = body.value;
    if (from) this.fromActorId = from.value;
  }

  // ─── Helpers ──────────────────────────────────────────────

  _getDefaultFromActor() {
    if (game.user.character) return game.user.character.id;
    const owned = game.actors.find(a => a.isOwner);
    return owned?.id || null;
  }
}
