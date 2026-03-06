/**
 * Message Composer Application — Sprint 4.5 Redesign
 * @file scripts/ui/MessageComposer/MessageComposerApp.js
 * @module cyberpunkred-messenger
 * @description Full-featured composer with condensed header, HUD strip, network
 *   effects strip, chip-based recipients with autocomplete, encryption toggle,
 *   self-destruct timer, schedule bar, rich contenteditable editor, attachments
 *   with eddies, GM send-as picker, validation, dead-zone queue, auto-save.
 *
 * ─── WORK PACKAGES ───
 *  WP-4.5.3 — Core rewrite (_prepareContext + _onRender scaffolding)
 *  WP-4.5.4 — Recipient autocomplete + network filtering
 *  WP-4.5.5 — Encryption + self-destruct + eddies
 *  WP-4.5.6 — GM send-as + schedule + auto-save
 *  WP-4.5.7 — Validation + send flow + animation
 */

import { MODULE_ID, EVENTS } from '../../utils/constants.js';
import { getInitials, getAvatarColor } from '../../utils/designHelpers.js';

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
      width: 640,
      height: 560,
    },
    actions: {
      send: MessageComposerApp._onSend,
      cancel: MessageComposerApp._onCancel,
      queueMessage: MessageComposerApp._onQueueMessage,
      saveDraft: MessageComposerApp._onSaveDraft,
      setPriority: MessageComposerApp._onSetPriority,
      setEncryption: MessageComposerApp._onSetEncryption,
      cycleEncryptionType: MessageComposerApp._onCycleEncryptionType,
      toggleSelfDestruct: MessageComposerApp._onToggleSelfDestruct,
      setSelfDestructMode: MessageComposerApp._onSetSelfDestructMode,
      toggleSchedule: MessageComposerApp._onToggleSchedule,
      toggleGameTime: MessageComposerApp._onToggleGameTime,
      toggleSendAs: MessageComposerApp._onToggleSendAs,
      toggleCC: MessageComposerApp._onToggleCC,
      toggleQuote: MessageComposerApp._onToggleQuote,
      removeRecipient: MessageComposerApp._onRemoveRecipient,
      removeAttachment: MessageComposerApp._onRemoveAttachment,
      attachFile: MessageComposerApp._onAttachFile,
      attachShard: MessageComposerApp._onAttachShard,
      attachEddies: MessageComposerApp._onAttachEddies,
      editorCommand: MessageComposerApp._onEditorCommand,
    },
  };

  static PARTS = {
    composer: {
      template: `modules/${MODULE_ID}/templates/message-composer/message-composer.hbs`,
    },
  };

  // ─── Instance State ───────────────────────────────────────

  /** @type {string} 'compose' | 'reply' | 'forward' */
  mode = 'compose';

  /** @type {string|null} From actor ID */
  fromActorId = null;

  /** @type {Array<{actorId: string, name: string, email: string, avatarColor: string, initials: string, mismatch: boolean, mismatchTooltip: string, unreachable: boolean, locked: boolean}>} */
  recipients = [];

  /** @type {string} Subject */
  subject = '';

  /** @type {string} Body (HTML) */
  body = '';

  /** @type {string} Priority: 'normal' | 'urgent' | 'critical' */
  priority = 'normal';

  /** @type {Object|null} Original message (for reply/forward) */
  originalMessage = null;

  /** @type {string|null} Thread ID */
  threadId = null;

  /** @type {string|null} In-reply-to message ID */
  inReplyTo = null;

  // Encryption
  /** @type {boolean} */
  encryptionEnabled = false;
  /** @type {number} */
  encryptionDV = 12;
  /** @type {string} 'ICE' | 'BLACK_ICE' | 'RED_ICE' */
  encryptionType = 'ICE';

  // Self-destruct
  /** @type {boolean} */
  selfDestructEnabled = false;
  /** @type {string} 'after_read' | '1h' | '6h' | '24h' */
  selfDestructMode = 'after_read';

  // Schedule
  /** @type {boolean} */
  scheduleEnabled = false;
  /** @type {string} */
  scheduledTime = '';
  /** @type {boolean} */
  scheduleGameTime = false;

  // Attachments
  /** @type {Array<{name: string, size: string, icon: string, itemId?: string, encrypted: boolean, isEddies: boolean, eddiesAmount?: number, eddiesFormatted?: string}>} */
  attachments = [];

  // Eddies
  /** @type {number} */
  eddiesAmount = 0;

  // GM Send-As
  /** @type {boolean} */
  sendAsDropdownOpen = false;

  // CC
  /** @type {boolean} */
  ccFieldVisible = false;

  // Auto-save
  /** @type {string|null} */
  autoSaveTime = null;
  /** @type {number|null} */
  _autoSaveTimer = null;

  // Autocomplete
  /** @type {Array} */
  _searchResults = [];
  /** @type {number} */
  _selectedResultIndex = -1;

  // Validation
  /** @type {Object} */
  _errors = {};

  /** @type {boolean} */
  _sending = false;

  // ─── Service Accessors ────────────────────────────────────

  get messageService() { return game.nightcity?.messageService; }
  get contactRepo() { return game.nightcity?.contactRepository; }
  get networkService() { return game.nightcity?.networkService; }
  get soundService() { return game.nightcity?.soundService; }
  get eventBus() { return game.nightcity?.eventBus; }

  // ─── Constructor ──────────────────────────────────────────

  constructor(options = {}) {
    const instanceId = foundry.utils.randomID(8);
    super(foundry.utils.mergeObject(options, {
      id: `ncm-message-composer-${instanceId}`,
    }));

    this.mode = options.mode || 'compose';
    this.fromActorId = options.fromActorId || this._getDefaultFromActor();
    this.originalMessage = options.originalMessage || null;

    if (this.mode === 'reply' && this.originalMessage) {
      const reply = this.messageService?.buildReply(this.originalMessage, this.fromActorId, '');
      if (reply) {
        this._addRecipient(reply.toActorId, true);
        this.subject = reply.subject;
        this.threadId = reply.threadId;
        this.inReplyTo = reply.inReplyTo;
      }
      // Inherit encryption from original
      if (this.originalMessage.status?.encrypted && this.originalMessage.encryption) {
        this.encryptionEnabled = true;
        this.encryptionDV = this.originalMessage.encryption.dc || 12;
        this.encryptionType = this.originalMessage.encryption.type || 'ICE';
      }
    } else if (this.mode === 'forward' && this.originalMessage) {
      const fwd = this.messageService?.buildForward(this.originalMessage, this.fromActorId, '', '');
      if (fwd) {
        this.subject = fwd.subject;
        this.body = fwd.body;
      }
    } else {
      // New compose
      if (options.toActorId) this._addRecipient(options.toActorId, false);
      this.subject = options.subject || '';
      this.body = options.body || '';
      this.threadId = options.threadId || null;
      this.inReplyTo = options.inReplyTo || null;
    }

    // Priority applies to all modes
    if (options.priority) this.priority = options.priority;
  }

  // ─── Lifecycle ────────────────────────────────────────────

  async _prepareContext(options) {
    const ns = this.networkService;
    const network = ns?.currentNetwork;
    const isDeadZone = ns?.isDeadZone ?? false;
    const signalStrength = ns?.signalStrength ?? 100;
    const networkName = isDeadZone ? 'DEAD ZONE' : (network?.name?.toUpperCase() || 'OFFLINE');
    const networkThemeColor = isDeadZone ? null : (network?.theme?.color || null);

    // Signal bars (4 bars)
    const barCount = 4;
    const activeBars = isDeadZone ? 0 : Math.ceil((signalStrength / 100) * barCount);
    const signalBars = Array.from({ length: barCount }, (_, i) => i < activeBars);

    // From actor
    const fromActor = game.actors.get(this.fromActorId);
    const fromName = fromActor?.name || 'Unknown';
    const fromEmail = this.contactRepo?.getActorEmail(this.fromActorId) || '';
    const fromAvatarColor = fromActor ? getAvatarColor(fromActor.name) : null;

    // Mode label
    const isGM = game.user.isGM;
    const isGMSendAs = isGM && this.fromActorId !== this._getDefaultFromActor();
    let modeLabelText, modeLabelIcon, modeLabelIconColor, modeLabelClass;

    if (isGMSendAs) {
      modeLabelText = 'SEND AS';
      modeLabelIcon = 'fa-masks-theater';
      modeLabelIconColor = '';
      modeLabelClass = 'ncm-mode-label--gm';
    } else if (this.mode === 'reply') {
      modeLabelText = 'REPLY';
      modeLabelIcon = 'fa-reply';
      modeLabelIconColor = '';
      modeLabelClass = 'ncm-mode-label--reply';
    } else if (this.mode === 'forward') {
      modeLabelText = 'FORWARD';
      modeLabelIcon = 'fa-share';
      modeLabelIconColor = '';
      modeLabelClass = 'ncm-mode-label--forward';
    } else {
      modeLabelText = 'NEW MSG';
      modeLabelIcon = 'fa-pen';
      modeLabelIconColor = 'cyan';
      modeLabelClass = '';
    }

    // HUD data
    const recipientCount = this.recipients.length;
    const hudToLabel = recipientCount === 0 ? 'NONE'
      : recipientCount === 1 ? this.recipients[0].name.toUpperCase()
      : `${recipientCount} RECIPIENTS`;
    const hudFromLabel = isGMSendAs ? fromName.toUpperCase() : '';

    const hudNetClass = isDeadZone ? 'ncm-hud-item--danger' : '';
    const hudSigClass = isDeadZone ? 'ncm-hud-item--danger' : signalStrength < 50 ? 'ncm-hud-item--warn' : '';
    const hudToClass = recipientCount === 0 ? (this._errors.to ? 'ncm-hud-item--danger' : '') : 'ncm-hud-item--accent';
    const hudPriClass = this.priority === 'critical' ? 'ncm-hud-item--danger'
      : this.priority === 'urgent' ? 'ncm-hud-item--warn' : '';
    const hudEncClass = this.encryptionEnabled ? 'ncm-hud-item--gold' : '';
    const hudEncLabel = this.encryptionEnabled ? `ICE DV${this.encryptionDV}` : 'OPEN';
    const hudPriLabel = this.priority.toUpperCase();

    // HUD status
    let hudStatusText, hudStatusColor, hudStatusIcon;
    if (this._errors.to || this._errors.general) {
      hudStatusText = 'VALIDATION ERROR';
      hudStatusColor = 'var(--ncm-danger)';
      hudStatusIcon = '';
    } else if (isDeadZone) {
      hudStatusText = 'NO SIGNAL';
      hudStatusColor = 'var(--ncm-danger)';
      hudStatusIcon = '';
    } else if (this.selfDestructEnabled) {
      hudStatusText = 'SELF-DESTRUCT';
      hudStatusColor = 'var(--ncm-danger)';
      hudStatusIcon = 'fa-bomb';
    } else if (isGMSendAs) {
      hudStatusText = 'GM MODE';
      hudStatusColor = 'var(--ncm-accent)';
      hudStatusIcon = '';
    } else {
      hudStatusText = 'READY';
      hudStatusColor = 'var(--ncm-success)';
      hudStatusIcon = '';
    }

    // Effects tags
    const effectTags = this._buildEffectTags(network, isDeadZone);

    // Priorities
    const priorities = [
      { id: 'normal', label: 'Normal', active: this.priority === 'normal' },
      { id: 'urgent', label: 'Urgent', active: this.priority === 'urgent' },
      { id: 'critical', label: 'Critical', active: this.priority === 'critical' },
    ];

    // Self-destruct options
    const selfDestructOptions = [
      { id: 'after_read', label: 'After Read', active: this.selfDestructMode === 'after_read' },
      { id: '1h', label: '1 Hour', active: this.selfDestructMode === '1h' },
      { id: '6h', label: '6 Hours', active: this.selfDestructMode === '6h' },
      { id: '24h', label: '24 Hours', active: this.selfDestructMode === '24h' },
    ];

    // Quote block (reply/forward)
    let quoteBlock = null;
    if ((this.mode === 'reply' || this.mode === 'forward') && this.originalMessage) {
      const orig = this.originalMessage;
      const senderActor = game.actors.get(orig.fromActorId);
      quoteBlock = {
        sender: senderActor?.name || orig.from || 'Unknown',
        time: orig.timestamp ? new Date(orig.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        network: orig.network || 'CITINET',
        body: orig.body || '',
      };
    }

    // Darknet detection
    const isDarknet = !isDeadZone && network?.effects?.anonymity;
    const degradedSignal = signalStrength < 75;
    const reliabilityFailChance = network ? Math.round(100 - (network.reliability || 100)) : 0;

    // Character count
    const charCount = this._getEditorText().length;

    return {
      MODULE_ID,
      mode: this.mode,
      isReply: this.mode === 'reply',
      isForward: this.mode === 'forward',
      isGM,
      isGMSendAs,

      // Header
      fromName,
      fromEmail,
      fromImg: fromActor?.img || null,
      fromAvatarColor,
      networkName,
      networkThemeColor,
      isDeadZone,
      signalBars,
      signalPercent: signalStrength,
      modeLabelText,
      modeLabelIcon,
      modeLabelIconColor,
      modeLabelClass,

      // HUD
      hudNetClass, hudSigClass, hudToClass, hudPriClass, hudEncClass,
      hudToLabel, hudFromLabel, hudPriLabel, hudEncLabel,
      hudStatusText, hudStatusColor, hudStatusIcon,

      // Effects
      effectTags,

      // Fields
      recipients: this.recipients,
      recipientLocked: this.mode === 'reply' && this.recipients.length > 0,
      subject: this.subject,
      body: this.body,
      priorities,

      // Encryption
      encryptionEnabled: this.encryptionEnabled,
      encryptionDV: this.encryptionDV,
      encryptionType: this.encryptionType,

      // Self-destruct
      selfDestructEnabled: this.selfDestructEnabled,
      selfDestructOptions,

      // Schedule
      scheduleEnabled: this.scheduleEnabled,
      scheduledTime: this.scheduledTime,
      scheduleGameTime: this.scheduleGameTime,

      // Editor
      charCount,

      // Quote
      quoteBlock,

      // Alerts
      isDarknet,
      degradedSignal,
      reliabilityFailChance,

      // Attachments
      attachments: this.attachments,
      hasAttachments: this.attachments.length > 0,

      // Validation
      errors: this._errors,

      // Footer
      sending: this._sending,
      autoSaveTime: this.autoSaveTime,
    };
  }

  _onRender(context, options) {
    this._setupRecipientAutocomplete();
    this._setupEditorSync();
    this._setupFormSync();
    this._setupKeyboardShortcuts();
    this._startAutoSave();

    // Focus recipient input on new compose, editor on reply
    requestAnimationFrame(() => {
      if (this.mode === 'compose' && this.recipients.length === 0) {
        this.element?.querySelector('[data-id="recipient-input"]')?.focus();
      } else {
        this.element?.querySelector('[data-id="editor-content"]')?.focus();
      }
    });
  }

  close(options) {
    this._stopAutoSave();
    return super.close(options);
  }

  // ─── Effects Tags Builder ─────────────────────────────────

  _buildEffectTags(network, isDeadZone) {
    const tags = [];

    if (isDeadZone) {
      tags.push({ label: 'No Signal', icon: 'fa-ban', variant: 'no-route' });
      tags.push({ label: 'Queued Until Reconnect', icon: 'fa-hourglass-half', variant: 'delay' });
      return tags;
    }

    if (!network) return tags;

    // Routing
    if (!network.effects?.canRoute)
      tags.push({ label: 'No Cross-Routing', icon: 'fa-ban', variant: 'no-route' });
    else
      tags.push({ label: 'Standard Routing', icon: 'fa-check', variant: 'ok' });

    // Traced
    if (network.effects?.traced)
      tags.push({ label: 'Traced', icon: 'fa-eye', variant: 'traced' });

    // Anonymous
    if (network.effects?.anonymity)
      tags.push({ label: 'Anonymous', icon: 'fa-user-secret', variant: 'anon' });

    // Restricted
    if (network.effects?.restrictedAccess)
      tags.push({ label: 'Restricted Access', icon: 'fa-lock', variant: 'restricted' });

    // Delay
    if (network.effects?.messageDelay > 0)
      tags.push({ label: `${network.effects.messageDelay}ms Delay`, icon: 'fa-hourglass-half', variant: 'delay' });

    // Reliability
    if ((network.reliability ?? 100) < 85)
      tags.push({ label: `${network.reliability}% Reliable`, icon: 'fa-signal', variant: 'reliability' });

    // Encryption (from composer state)
    if (this.encryptionEnabled)
      tags.push({ label: `ICE DV ${this.encryptionDV}`, icon: 'fa-shield-halved', variant: 'encrypted' });
    else
      tags.push({ label: 'Cleartext', icon: 'fa-unlock', variant: 'open' });

    // Self-destruct
    if (this.selfDestructEnabled)
      tags.push({ label: 'Self-Destruct', icon: 'fa-bomb', variant: 'destruct' });

    return tags;
  }

  // ─── Recipient Management ─────────────────────────────────

  _addRecipient(actorId, locked = false) {
    if (!actorId || this.recipients.find(r => r.actorId === actorId)) return;

    const actor = game.actors.get(actorId);
    if (!actor) return;

    const name = actor.name;
    const email = this.contactRepo?.getActorEmail(actorId) || '';
    const avatarColor = getAvatarColor(name);
    const initials = getInitials(name);

    // Network mismatch check
    const reachableIds = this.networkService?.getReachableNetworkIds() || [];
    // TODO: check contact's primary network against reachable list
    // For now, no mismatch detection (requires contact network data)

    this.recipients.push({
      actorId,
      name,
      email,
      avatarColor,
      initials,
      mismatch: false,
      mismatchTooltip: '',
      unreachable: false,
      locked,
    });

    // Clear TO validation error
    if (this._errors.to) {
      delete this._errors.to;
    }
  }

  _removeRecipient(actorId) {
    this.recipients = this.recipients.filter(r => r.actorId !== actorId);
  }

  // ─── Recipient Autocomplete (WP-4.5.4) ───────────────────

  _setupRecipientAutocomplete() {
    const input = this.element?.querySelector('[data-id="recipient-input"]');
    if (!input) return;

    let debounceTimer;
    input.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this._searchRecipients(e.target.value);
      }, 200);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._navigateAutocomplete(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._navigateAutocomplete(-1);
      } else if (e.key === 'Enter' && this._selectedResultIndex >= 0) {
        e.preventDefault();
        this._selectAutocompleteResult(this._selectedResultIndex);
      } else if (e.key === 'Escape') {
        this._closeAutocomplete();
      } else if (e.key === 'Backspace' && !e.target.value && this.recipients.length > 0) {
        // Remove last chip
        const last = this.recipients[this.recipients.length - 1];
        if (!last.locked) {
          this._removeRecipient(last.actorId);
          this.render(true);
        }
      }
    });

    // Close on click outside
    const handler = (e) => {
      if (!this.element?.contains(e.target)) {
        this._closeAutocomplete();
        document.removeEventListener('click', handler);
      }
    };
    document.addEventListener('click', handler);
  }

  async _searchRecipients(query) {
    if (!query || query.length < 1) {
      this._closeAutocomplete();
      return;
    }

    const directory = this.contactRepo?.getGlobalActorDirectory() || [];
    const q = query.toLowerCase();
    const existingIds = new Set(this.recipients.map(r => r.actorId));
    const reachableIds = this.networkService?.getReachableNetworkIds() || [];

    let results = directory.filter(a =>
      !existingIds.has(a.actorId) && (
        a.name?.toLowerCase().includes(q) ||
        a.email?.toLowerCase().includes(q)
      )
    ).slice(0, 6);

    // Also search contacts for from actor
    if (this.fromActorId) {
      const contacts = await this.contactRepo?.searchContacts(this.fromActorId, query) || [];
      for (const contact of contacts) {
        if (contact.actorId && !existingIds.has(contact.actorId) && !results.find(r => r.actorId === contact.actorId)) {
          results.push({
            actorId: contact.actorId,
            name: contact.name,
            email: contact.email,
            img: contact.customImg || null,
          });
        }
      }
    }

    // Mark reachability
    results = results.map(r => ({
      ...r,
      initials: getInitials(r.name),
      avatarColor: getAvatarColor(r.name),
      // TODO: determine contact's network to check reachability
      greyed: false,
      unreachableLabel: null,
    }));

    this._searchResults = results;
    this._selectedResultIndex = results.length > 0 ? 0 : -1;
    this._renderAutocomplete(query);
  }

  _renderAutocomplete(query) {
    const dropdown = this.element?.querySelector('[data-id="autocomplete-dropdown"]');
    if (!dropdown) return;

    if (this._searchResults.length === 0 && !query) {
      dropdown.classList.add('ncm-hidden');
      return;
    }

    dropdown.classList.remove('ncm-hidden');

    const items = this._searchResults.map((r, i) => `
      <div class="ncm-autocomplete-item ${i === this._selectedResultIndex ? 'ncm-autocomplete-item--selected' : ''} ${r.greyed ? 'ncm-autocomplete-item--greyed' : ''}"
           data-index="${i}" data-actor-id="${r.actorId}">
        <div class="ncm-autocomplete__avatar" style="color: ${r.avatarColor}; border-color: ${r.avatarColor}30;">${r.initials}</div>
        <div class="ncm-autocomplete__info">
          <div class="ncm-autocomplete__name">${r.name}</div>
          <div class="ncm-autocomplete__email">${r.email || ''}</div>
        </div>
        ${r.unreachableLabel ? `<span class="ncm-autocomplete__unreachable"><i class="fas fa-ban"></i> ${r.unreachableLabel}</span>` : ''}
      </div>
    `).join('');

    // Raw address fallback
    const fallback = query ? `
      <div class="ncm-autocomplete-item ncm-autocomplete-item--fallback" data-index="${this._searchResults.length}" data-raw="${query}">
        <div class="ncm-autocomplete__avatar" style="color: var(--ncm-text-muted); border-color: var(--ncm-border);"><i class="fas fa-at" style="font-size:9px;"></i></div>
        <div class="ncm-autocomplete__info">
          <div class="ncm-autocomplete__name" style="color: var(--ncm-text-secondary);">Send to "${query}" as raw address</div>
          <div class="ncm-autocomplete__sub"><i class="fas fa-triangle-exclamation" style="color:var(--ncm-warning); margin-right:2px;"></i> Unverified — contact not in directory</div>
        </div>
      </div>
    ` : '';

    dropdown.innerHTML = items + fallback;

    // Click handlers on items
    dropdown.querySelectorAll('.ncm-autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index);
        if (item.dataset.raw) {
          // Raw address — treat as name
          // For now, just close (raw address support would need extended data model)
          this._closeAutocomplete();
        } else {
          this._selectAutocompleteResult(idx);
        }
      });
    });
  }

  _navigateAutocomplete(direction) {
    const max = this._searchResults.length; // +1 for fallback? keep simple
    if (max === 0) return;
    this._selectedResultIndex = (this._selectedResultIndex + direction + max) % max;
    this._renderAutocomplete(null);
  }

  _selectAutocompleteResult(index) {
    const result = this._searchResults[index];
    if (!result || result.greyed) return;

    this._addRecipient(result.actorId);
    this._closeAutocomplete();
    this.render(true);
  }

  _closeAutocomplete() {
    this._searchResults = [];
    this._selectedResultIndex = -1;
    const dropdown = this.element?.querySelector('[data-id="autocomplete-dropdown"]');
    if (dropdown) {
      dropdown.classList.add('ncm-hidden');
      dropdown.innerHTML = '';
    }
  }

  // ─── Editor Sync ──────────────────────────────────────────

  _setupEditorSync() {
    const editor = this.element?.querySelector('[data-id="editor-content"]');
    if (!editor) return;

    editor.addEventListener('input', () => {
      this.body = editor.innerHTML;
      const counter = this.element?.querySelector('[data-id="editor-counter"]');
      if (counter) {
        counter.textContent = `${this._getEditorText().length} chars`;
      }
    });
  }

  _getEditorText() {
    const editor = this.element?.querySelector('[data-id="editor-content"]');
    if (editor) return editor.textContent || '';
    // Fallback: strip HTML from body
    const div = document.createElement('div');
    div.innerHTML = this.body;
    return div.textContent || '';
  }

  // ─── Form Sync ────────────────────────────────────────────

  _setupFormSync() {
    const subjectInput = this.element?.querySelector('[data-id="subject-input"]');
    if (subjectInput) {
      subjectInput.addEventListener('input', (e) => { this.subject = e.target.value; });
    }

    const dvInput = this.element?.querySelector('[data-id="encryption-dv"]');
    if (dvInput) {
      dvInput.addEventListener('change', (e) => {
        this.encryptionDV = Math.max(1, Math.min(30, parseInt(e.target.value) || 12));
      });
    }

    const scheduleInput = this.element?.querySelector('[data-id="schedule-input"]');
    if (scheduleInput) {
      scheduleInput.addEventListener('change', (e) => { this.scheduledTime = e.target.value; });
    }
  }

  // ─── Keyboard Shortcuts ───────────────────────────────────

  _setupKeyboardShortcuts() {
    const handler = (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        if (this.networkService?.isDeadZone) {
          MessageComposerApp._onQueueMessage.call(this, e, null);
        } else {
          MessageComposerApp._onSend.call(this, e, null);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    };

    this.element?.addEventListener('keydown', handler);
  }

  // ─── Auto-Save (WP-4.5.6) ────────────────────────────────

  _startAutoSave() {
    this._stopAutoSave();
    this._autoSaveTimer = setInterval(() => {
      this._performAutoSave();
    }, 30000); // 30 seconds
  }

  _stopAutoSave() {
    if (this._autoSaveTimer) {
      clearInterval(this._autoSaveTimer);
      this._autoSaveTimer = null;
    }
  }

  _performAutoSave() {
    // Sync latest editor content
    const editor = this.element?.querySelector('[data-id="editor-content"]');
    if (editor) this.body = editor.innerHTML;

    // Save draft timestamp
    const now = new Date();
    this.autoSaveTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Update the auto-save indicator without full re-render
    const indicator = this.element?.querySelector('.ncm-autosave');
    if (indicator) {
      indicator.innerHTML = `<i class="fas fa-check-circle"></i> Draft saved ${this.autoSaveTime}`;
    }

    // TODO: persist draft to actor flags for recovery
  }

  // ─── GM Send-As (WP-4.5.6) ───────────────────────────────

  _renderSendAsList(filter = '') {
    const list = this.element?.querySelector('[data-id="sendas-list"]');
    if (!list) return;

    const allActors = game.actors.filter(a => {
      const email = this.contactRepo?.getActorEmail(a.id);
      return email; // Only actors with email
    });

    const q = filter.toLowerCase();
    const filtered = q
      ? allActors.filter(a => a.name.toLowerCase().includes(q) || (this.contactRepo?.getActorEmail(a.id) || '').toLowerCase().includes(q))
      : allActors;

    list.innerHTML = filtered.slice(0, 20).map(a => {
      const email = this.contactRepo?.getActorEmail(a.id) || '';
      const isActive = a.id === this.fromActorId;
      const color = getAvatarColor(a.name);
      const initials = getInitials(a.name);
      return `
        <div class="ncm-sendas-item ${isActive ? 'ncm-sendas-item--active' : ''}" data-actor-id="${a.id}">
          <div class="ncm-sendas-item__avatar" style="color: ${color};">${initials}</div>
          <div class="ncm-sendas-item__info">
            <div class="ncm-sendas-item__name">${a.name}</div>
            <div class="ncm-sendas-item__email">${email}</div>
          </div>
          <span class="ncm-sendas-item__type">${a.type || 'NPC'}</span>
        </div>
      `;
    }).join('');

    // Click handlers
    list.querySelectorAll('.ncm-sendas-item').forEach(item => {
      item.addEventListener('click', () => {
        this.fromActorId = item.dataset.actorId;
        this.sendAsDropdownOpen = false;
        this.render(true);
      });
    });
  }

  // ─── Action Handlers ──────────────────────────────────────

  /** @this {MessageComposerApp} */
  static async _onSend(event, target) {
    if (this._sending) return;

    // Sync form
    this._syncFormData();

    // Validate (WP-4.5.7)
    this._errors = {};
    if (this.recipients.length === 0) {
      this._errors.to = 'Recipient required';
    }
    if (!this.subject.trim() && !this._getEditorText().trim()) {
      this._errors.general = 'Message must have a subject or body.';
    }

    if (Object.keys(this._errors).length > 0) {
      this.render(true);
      return;
    }

    this._sending = true;
    this.render(true);

    try {
      // Build message data
      const toActorId = this.recipients.length === 1
        ? this.recipients[0].actorId
        : this.recipients.map(r => r.actorId);

      const messageData = {
        toActorId,
        fromActorId: this.fromActorId,
        subject: this.subject,
        body: this.body,
        priority: this.priority,
        threadId: this.threadId,
        inReplyTo: this.inReplyTo,
        attachments: this.attachments.filter(a => !a.isEddies),
        eddies: this.eddiesAmount || 0,
        metadata: {
          scheduledDelivery: this.scheduleEnabled ? this.scheduledTime : null,
        },
      };

      // Encryption
      if (this.encryptionEnabled) {
        messageData.encryption = {
          type: this.encryptionType,
          dc: this.encryptionDV,
        };
        messageData.status = { encrypted: true };
      }

      // Self-destruct
      if (this.selfDestructEnabled) {
        messageData.selfDestruct = {
          mode: this.selfDestructMode,
          expiresAt: this._computeExpiry(),
        };
      }

      const result = await this.messageService?.sendMessage(messageData);

      if (result?.success) {
        ui.notifications.info(result.queued ? 'Message queued for delivery.' : 'Message sent.');
        this.soundService?.play('send');
        this.close();
      } else {
        ui.notifications.error(`Send failed: ${result?.error || 'Unknown error'}`);
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

  static _onQueueMessage(event, target) {
    // Queue for dead zone — same as send, messageService handles queuing
    MessageComposerApp._onSend.call(this, event, target);
  }

  static _onSaveDraft(event, target) {
    this._performAutoSave();
    ui.notifications.info('Draft saved.');
  }

  static _onSetPriority(event, target) {
    const priority = target.dataset.priority;
    if (priority) {
      this.priority = priority;
      this.render(true);
    }
  }

  // ── Encryption (WP-4.5.5) ──

  static _onSetEncryption(event, target) {
    const value = target.dataset.value;
    this.encryptionEnabled = value === 'ice';
    this.render(true);
  }

  static _onCycleEncryptionType(event, target) {
    const types = ['ICE', 'BLACK_ICE', 'RED_ICE'];
    const idx = types.indexOf(this.encryptionType);
    this.encryptionType = types[(idx + 1) % types.length];
    this.render(true);
  }

  // ── Self-Destruct (WP-4.5.5) ──

  static _onToggleSelfDestruct(event, target) {
    this.selfDestructEnabled = !this.selfDestructEnabled;
    this.render(true);
  }

  static _onSetSelfDestructMode(event, target) {
    this.selfDestructMode = target.dataset.mode;
    this.render(true);
  }

  // ── Schedule (WP-4.5.6) ──

  static _onToggleSchedule(event, target) {
    this.scheduleEnabled = !this.scheduleEnabled;
    this.render(true);
  }

  static _onToggleGameTime(event, target) {
    this.scheduleGameTime = !this.scheduleGameTime;
    this.render(true);
  }

  // ── GM Send-As (WP-4.5.6) ──

  static _onToggleSendAs(event, target) {
    if (!game.user.isGM) return;
    this.sendAsDropdownOpen = !this.sendAsDropdownOpen;

    const dropdown = this.element?.querySelector('[data-id="sendas-dropdown"]');
    if (!dropdown) return;

    if (this.sendAsDropdownOpen) {
      dropdown.classList.remove('ncm-hidden');
      this._renderSendAsList();
      // Setup search
      const searchInput = dropdown.querySelector('[data-id="sendas-search"]');
      if (searchInput) {
        searchInput.focus();
        searchInput.addEventListener('input', (e) => {
          this._renderSendAsList(e.target.value);
        });
      }
    } else {
      dropdown.classList.add('ncm-hidden');
    }
  }

  // ── CC ──

  static _onToggleCC(event, target) {
    this.ccFieldVisible = !this.ccFieldVisible;
    const ccField = this.element?.querySelector('[data-id="cc-field"]');
    if (ccField) {
      ccField.classList.toggle('ncm-hidden', !this.ccFieldVisible);
    }
  }

  // ── Quote ──

  static _onToggleQuote(event, target) {
    const body = this.element?.querySelector('[data-id="quote-body"]');
    if (body) {
      body.classList.toggle('ncm-quote-block__body--expanded');
      const icon = target.querySelector('i');
      if (icon) {
        icon.classList.toggle('fa-chevron-down');
        icon.classList.toggle('fa-chevron-up');
      }
      const text = body.classList.contains('ncm-quote-block__body--expanded')
        ? 'Hide full message' : 'Show full message';
      target.childNodes[target.childNodes.length - 1].textContent = ` ${text}`;
    }
  }

  // ── Recipients ──

  static _onRemoveRecipient(event, target) {
    const actorId = target.dataset.actorId;
    if (actorId) {
      this._removeRecipient(actorId);
      this.render(true);
    }
  }

  // ── Attachments (WP-4.5.5) ──

  static _onRemoveAttachment(event, target) {
    const index = parseInt(target.dataset.index);
    if (!isNaN(index)) {
      const removed = this.attachments.splice(index, 1)[0];
      if (removed?.isEddies) this.eddiesAmount = 0;
      this.render(true);
    }
  }

  static _onAttachFile(event, target) {
    // TODO: file picker dialog integration
    ui.notifications.info('File attachment coming in a future update.');
  }

  static _onAttachShard(event, target) {
    // TODO: data shard picker integration
    ui.notifications.info('Data shard attachment coming in a future update.');
  }

  static _onAttachEddies(event, target) {
    // Simple prompt for now
    const actor = game.actors.get(this.fromActorId);
    const currentEddies = actor?.system?.wealth?.value ?? 0;

    const amount = parseInt(prompt(`Enter eddies amount (you have ${currentEddies} eb):`));
    if (isNaN(amount) || amount <= 0) return;

    if (amount > currentEddies) {
      ui.notifications.warn('Insufficient eddies.');
      return;
    }

    // Remove existing eddies attachment
    this.attachments = this.attachments.filter(a => !a.isEddies);

    this.eddiesAmount = amount;
    this.attachments.push({
      name: 'Eddies',
      size: '',
      icon: 'fa-coins',
      isEddies: true,
      eddiesAmount: amount,
      eddiesFormatted: `${amount.toLocaleString()} eb`,
      encrypted: false,
    });

    this.render(true);
  }

  // ── Editor Commands ──

  static _onEditorCommand(event, target) {
    const command = target.dataset.command;
    if (!command) return;

    switch (command) {
      case 'bold':
        document.execCommand('bold', false);
        break;
      case 'italic':
        document.execCommand('italic', false);
        break;
      case 'monospace':
        // Wrap selection in <code>
        document.execCommand('formatBlock', false, 'pre');
        break;
      case 'link': {
        const url = prompt('Enter URL:');
        if (url) document.execCommand('createLink', false, url);
        break;
      }
      default:
        break;
    }
  }

  // ─── Form Data Sync ───────────────────────────────────────

  _syncFormData() {
    const el = this.element;
    if (!el) return;

    const subject = el.querySelector('[data-id="subject-input"]');
    if (subject) this.subject = subject.value;

    const editor = el.querySelector('[data-id="editor-content"]');
    if (editor) this.body = editor.innerHTML;

    const dv = el.querySelector('[data-id="encryption-dv"]');
    if (dv) this.encryptionDV = parseInt(dv.value) || 12;

    const schedule = el.querySelector('[data-id="schedule-input"]');
    if (schedule) this.scheduledTime = schedule.value;
  }

  // ─── Helpers ──────────────────────────────────────────────

  _getDefaultFromActor() {
    if (game.user.character) return game.user.character.id;
    const owned = game.actors?.find(a => a.isOwner);
    return owned?.id || null;
  }

  _computeExpiry() {
    const now = Date.now();
    switch (this.selfDestructMode) {
      case '1h': return new Date(now + 3600000).toISOString();
      case '6h': return new Date(now + 21600000).toISOString();
      case '24h': return new Date(now + 86400000).toISOString();
      case 'after_read':
      default: return null; // handled on read
    }
  }
}
