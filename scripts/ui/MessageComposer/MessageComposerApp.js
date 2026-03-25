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
import { formatCyberDate } from '../../utils/helpers.js';
import { CyberTimePicker } from '../components/CyberTimePicker.js';

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
      setFailureMode: MessageComposerApp._onSetFailureMode,
      setIceSource: MessageComposerApp._onSetIceSource,
      setIceActor: MessageComposerApp._onSetIceActor,
      toggleSelfDestruct: MessageComposerApp._onToggleSelfDestruct,
      setSelfDestructMode: MessageComposerApp._onSetSelfDestructMode,
      toggleSchedule: MessageComposerApp._onToggleSchedule,
      toggleSendAs: MessageComposerApp._onToggleSendAs,
      toggleCC: MessageComposerApp._onToggleCC,
      toggleQuote: MessageComposerApp._onToggleQuote,
      toggleOverflow: MessageComposerApp._onToggleOverflow,
      openSchedulePicker: MessageComposerApp._onOpenSchedulePicker,
      retrySend: MessageComposerApp._onRetrySend,
      removeRecipient: MessageComposerApp._onRemoveRecipient,
      removeAttachment: MessageComposerApp._onRemoveAttachment,
      attachFile: MessageComposerApp._onAttachFile,
      attachShard: MessageComposerApp._onAttachShard,
      attachEddies: MessageComposerApp._onAttachEddies,
      editorCommand: MessageComposerApp._onEditorCommand,
      insertTimestamp: MessageComposerApp._onInsertTimestamp,
      insertCoords: MessageComposerApp._onInsertCoords,
      insertSignature: MessageComposerApp._onInsertSignature,
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

  /** @type {Object|null} From master contact (when no actor linked) — { id, name, email, portrait } */
  fromContact = null;

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
  /** @type {string} 'nothing' | 'damage' | 'lockout' */
  encryptionFailureMode = 'nothing';
  /** @type {number} Max attempts before lockout (0 = unlimited) */
  encryptionMaxAttempts = 0;
  /** @type {string} 'default' | 'actor' | 'custom' */
  iceSource = 'default';
  /** @type {string|null} Actor ID for ICE actor source */
  iceActorId = null;
  /** @type {string[]|null} Allowed bypass skills */
  encryptionBypassSkills = null;

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
  get schedulingService() { return game.nightcity?.schedulingService; }
  get timeService() { return game.nightcity?.timeService; }

  // ─── Constructor ──────────────────────────────────────────

  constructor(options = {}) {
    const instanceId = foundry.utils.randomID(8);
    super(foundry.utils.mergeObject(options, {
      id: `ncm-message-composer-${instanceId}`,
    }));

    this.mode = options.mode || 'compose';

    // Resolve sender identity — actor or contact
    if (options.fromContact) {
      // Send-as a master contact (no linked actor)
      this.fromContact = options.fromContact;
      this.fromActorId = null; // No actor backing
    } else if (options.fromContactId) {
      // Resolve contact from ID
      const contact = game.nightcity?.masterContactService?.getContact(options.fromContactId);
      if (contact) {
        this.fromContact = { id: contact.id, name: contact.name, email: contact.email, portrait: contact.portrait };
        this.fromActorId = contact.actorId || null;
      } else {
        this.fromActorId = this._getDefaultFromActor();
      }
    } else {
      this.fromActorId = options.fromActorId || this._getDefaultFromActor();
    }

    this.originalMessage = options.originalMessage || null;

    if (this.mode === 'reply' && this.originalMessage) {
      const reply = this.messageService?.buildReply(this.originalMessage, this.fromActorId, '');
      if (reply) {
        if (reply.toActorId) {
          this._addRecipient(reply.toActorId, true);
        } else if (reply.toContactId || reply.to) {
          // Contact-only or raw email reply — add as a locked raw recipient
          const orig = this.originalMessage;
          const senderName = orig.fromName || orig.from || 'Unknown';
          const senderEmail = reply.to || orig.from || '';
          this.recipients.push({
            actorId: null,
            contactId: reply.toContactId || null,
            name: senderName,
            email: senderEmail,
            avatarColor: getAvatarColor(senderName),
            initials: getInitials(senderName),
            mismatch: false,
            mismatchTooltip: '',
            unreachable: false,
            locked: true,
            isRaw: !reply.toContactId,
          });
        }
        this.subject = reply.subject;
        this.threadId = reply.threadId;
        this.inReplyTo = reply.inReplyTo;
      } else {
        // buildReply unavailable (no messageService yet?) — fall back to original message data
        const orig = this.originalMessage;
        if (orig.fromActorId) {
          this._addRecipient(orig.fromActorId, true);
        } else {
          const senderName = orig.fromName || orig.from || 'Unknown';
          this.recipients.push({
            actorId: null,
            name: senderName,
            email: orig.from || '',
            avatarColor: getAvatarColor(senderName),
            initials: getInitials(senderName),
            mismatch: false,
            mismatchTooltip: '',
            unreachable: false,
            locked: true,
            isRaw: true,
          });
        }
        this.subject = orig.subject?.startsWith('RE: ') ? orig.subject : `RE: ${orig.subject || '(no subject)'}`;
        this.threadId = orig.threadId;
        this.inReplyTo = orig.messageId;
      }
      // Inherit encryption from original
      if (this.originalMessage.status?.encrypted && this.originalMessage.encryption) {
        this.encryptionEnabled = true;
        this.encryptionDV = this.originalMessage.encryption.dc || 12;
        this.encryptionType = this.originalMessage.encryption.type || 'ICE';
        this.encryptionFailureMode = this.originalMessage.encryption.failureMode || 'nothing';
        this.encryptionMaxAttempts = this.originalMessage.encryption.maxAttempts || 0;
        if (this.originalMessage.encryption.ice) {
          this.iceSource = this.originalMessage.encryption.ice.source || 'default';
          this.iceActorId = this.originalMessage.encryption.ice.actorId || null;
        }
        this.encryptionBypassSkills = this.originalMessage.encryption.bypassSkills || null;
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

    // Restore draft if opening fresh compose with no pre-filled data
    this._restoreDraft();
  }

  // ─── Lifecycle ────────────────────────────────────────────

  async _prepareContext(options) {
    const ns = this.networkService;
    const network = ns?.currentNetwork;
    const isDeadZone = ns?.isDeadZone ?? false;
    const signalStrength = ns?.signalStrength ?? 100;
    const networkName = isDeadZone ? 'DEAD ZONE' : (network?.name?.toUpperCase() || 'OFFLINE');
    const networkThemeColor = isDeadZone ? null : (network?.theme?.color || null);

    // From actor — or master contact fallback
    const fromActor = this.fromActorId ? game.actors.get(this.fromActorId) : null;
    const fromName = fromActor?.name || this.fromContact?.name || 'Unknown';
    const fromEmail = fromActor
      ? (this.contactRepo?.getActorEmail(this.fromActorId) || '')
      : (this.fromContact?.email || '');
    const fromAvatarColor = getAvatarColor(fromName);

    // Mode label + key
    const isGM = game.user.isGM;
    const isGMSendAs = isGM && (this.fromContact || this.fromActorId !== this._getDefaultFromActor());
    let modeLabelText, modeLabelIcon, modeKey;

    if (isGMSendAs) {
      modeLabelText = 'Send-As';
      modeLabelIcon = 'fa-masks-theater';
      modeKey = 'sendas';
    } else if (this.mode === 'reply') {
      modeLabelText = 'Reply';
      modeLabelIcon = 'fa-reply';
      modeKey = 'reply';
    } else if (this.mode === 'forward') {
      modeLabelText = 'Forward';
      modeLabelIcon = 'fa-share';
      modeKey = 'forward';
    } else {
      modeLabelText = 'New';
      modeLabelIcon = 'fa-pen';
      modeKey = 'compose';
    }

    // Network pill state
    const netPillState = isDeadZone ? 'dead'
      : (!isDeadZone && network?.effects?.anonymity) ? 'darknet' : 'connected';

    // Network pill bars [{active: bool}, ...]
    const barCount = 4;
    const activeBars = isDeadZone ? 0 : Math.ceil((signalStrength / 100) * barCount);
    const netPillBars = Array.from({ length: barCount }, (_, i) => ({ active: i < activeBars }));

    // Inline FX tags on net pill (compact version of old effects strip)
    const fxTags = [];
    if (isDeadZone) {
      fxTags.push({ label: 'DEAD ZONE', variant: 'danger' });
    } else if (network) {
      if (network.effects?.restrictedAccess) fxTags.push({ label: 'RESTRICTED', variant: 'warn' });
      if (network.effects?.anonymity) fxTags.push({ label: 'ANON', variant: 'info' });
      if (network.effects?.traced) fxTags.push({ label: 'TRACED', variant: 'danger' });
    }

    // Priorities
    const priorities = [
      { id: 'low', label: 'Low', active: this.priority === 'low' },
      { id: 'normal', label: 'Normal', active: this.priority === 'normal' },
      { id: 'high', label: 'High', active: this.priority === 'high' },
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

    // Original message card (reply/forward) — full rendered card data
    let originalMessageCard = null;
    if ((this.mode === 'reply' || this.mode === 'forward') && this.originalMessage) {
      const orig = this.originalMessage;
      const senderActor = game.actors.get(orig.fromActorId);
      const senderName = senderActor?.name || orig.from || 'Unknown';
      const senderEmail = senderActor
        ? (this.contactRepo?.getActorEmail(orig.fromActorId) || orig.from || '')
        : (orig.from || '');
      const origNetwork = orig.network || orig.metadata?.networkTrace || 'CITINET';

      // Try to resolve network color
      let origNetColor = null;
      const origNetObj = this.networkService?.getAllNetworks?.()?.find(
        n => n.name?.toUpperCase() === origNetwork.toUpperCase() || n.id === origNetwork
      );
      if (origNetObj?.theme?.color) origNetColor = origNetObj.theme.color;

      originalMessageCard = {
        sender: senderName,
        email: senderEmail,
        initials: getInitials(senderName),
        avatarColor: getAvatarColor(senderName),
        portrait: senderActor?.img || null,
        formattedTime: orig.timestamp ? formatCyberDate(orig.timestamp) : '',
        network: origNetwork.toUpperCase(),
        networkColor: origNetColor,
        subject: orig.subject || '',
        body: orig.body || '',
        encrypted: orig.status?.encrypted || false,
        encDV: orig.encryption?.dc || null,
        attachments: (orig.attachments || []).map(a => ({
          name: a.name || 'Attachment',
          icon: a.isEddies ? 'fa-coins' : (a.icon || 'fa-paperclip'),
          isEddies: a.isEddies || false,
        })),
        hasAttachments: (orig.attachments?.length || 0) > 0,
      };
    }

    // Darknet / alert state
    const isDarknet = !isDeadZone && network?.effects?.anonymity;
    const degradedSignal = signalStrength < 75;
    const reliabilityFailChance = network ? Math.round(100 - (network.reliability || 100)) : 0;

    // Character count
    const charCount = this._getEditorText().length;

    // Sender initials
    const fromInitials = getInitials(fromName);

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
      fromImg: fromActor?.img || this.fromContact?.portrait || null,
      fromInitials,
      fromAvatarColor,
      networkName,
      networkThemeColor,
      isDeadZone,
      netPillState,
      netPillBars,
      fxTags,
      modeLabelText,
      modeLabelIcon,
      modeKey,

      // Time
      currentGameTime: formatCyberDate(this.timeService?.getCurrentTime?.() || new Date().toISOString()),

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
      encryptionFailureMode: this.encryptionFailureMode,
      encryptionMaxAttempts: this.encryptionMaxAttempts,
      isLethalICE: this.encryptionType === 'BLACK_ICE' || this.encryptionType === 'RED_ICE',
      iceSource: this.iceSource,
      iceActorId: this.iceActorId,
      iceActors: game.nightcity?.iceService?.getAvailableICEActors() ?? [],

      // Self-destruct
      selfDestructEnabled: this.selfDestructEnabled,
      selfDestructOptions,

      // Schedule
      scheduleEnabled: this.scheduleEnabled,
      scheduledTime: this.scheduledTime,
      scheduledTimeFormatted: this.scheduledTime ? formatCyberDate(this.scheduledTime) : '',

      // Editor
      charCount,

      // Conversation context
      originalMessageCard,

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
    this._setupSendAsList();
    this._setupToolbarFocusGuard();
    this._setupEditorStateTracking();

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
    if (this._editorStateHandler) {
      document.removeEventListener('selectionchange', this._editorStateHandler);
      this._editorStateHandler = null;
    }
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
    let name, email;

    if (actor) {
      name = actor.name;
      email = this.contactRepo?.getActorEmail(actorId) || '';
    } else {
      // Actor not visible to this client — fall back to master contact data
      const masterService = game.nightcity?.masterContactService;
      const mc = masterService?.getAll?.()?.find(c => c.actorId === actorId);
      if (mc) {
        name = mc.name;
        email = mc.email || '';
      } else {
        // Last resort — check if we have info from the original message
        return; // Truly unknown, skip
      }
    }

    const avatarColor = getAvatarColor(name);
    const initials = getInitials(name);

    // Network mismatch check — look up contact's network from contact repo
    const reachableIds = this.networkService?.getReachableNetworkIds() || [];
    let mismatch = false;
    let mismatchTooltip = '';
    let unreachable = false;

    if (this.fromActorId && reachableIds.length > 0) {
      const contacts = this.contactRepo?.getContacts?.(this.fromActorId);
      const contact = contacts instanceof Promise ? null : contacts?.find(c => c.actorId === actorId);
      const contactNetwork = contact?.network?.toUpperCase() || '';

      if (contactNetwork && !reachableIds.includes(contactNetwork)) {
        // Contact is on an unreachable network
        const currentNetId = this.networkService?.currentNetworkId || '';
        if (this.networkService?.currentNetwork?.effects?.canRoute === false) {
          unreachable = true;
          mismatchTooltip = `Unreachable: ${contactNetwork} — no cross-routing on current network`;
        } else {
          mismatch = true;
          mismatchTooltip = `Cross-net: ${contactNetwork} — delivery may be delayed`;
        }
      }
    }

    this.recipients.push({
      actorId,
      name,
      email,
      avatarColor,
      initials,
      mismatch,
      mismatchTooltip,
      unreachable,
      locked,
    });

    // Clear TO validation error
    if (this._errors.to) {
      delete this._errors.to;
    }
  }

  _removeRecipient(actorId) {
    this.recipients = this.recipients.filter(r =>
      r.isRaw ? r.email !== actorId : r.actorId !== actorId
    );
  }

  _addRawRecipient(rawAddress) {
    if (!rawAddress) return;
    const email = rawAddress.trim();
    if (this.recipients.find(r => r.email === email)) return;

    this.recipients.push({
      actorId: null,
      name: email,
      email,
      avatarColor: getAvatarColor(email),
      initials: '@',
      mismatch: false,
      mismatchTooltip: '',
      unreachable: false,
      locked: false,
      isRaw: true,
    });

    if (this._errors.to) delete this._errors.to;
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

    // GM: also search master contact directory
    if (game.user.isGM) {
      const masterContacts = game.nightcity?.masterContactService?.search?.(query) || [];
      for (const mc of masterContacts) {
        if (mc.actorId && !existingIds.has(mc.actorId) && !results.find(r => r.actorId === mc.actorId)) {
          results.push({
            actorId: mc.actorId,
            name: mc.name,
            email: mc.email,
            img: mc.portrait || null,
          });
        }
      }
    }

    // Also search contacts for from actor — merge contact network data
    const contactsByActor = new Map();
    if (this.fromActorId) {
      const contacts = await this.contactRepo?.searchContacts(this.fromActorId, query) || [];
      for (const contact of contacts) {
        if (contact.actorId) {
          contactsByActor.set(contact.actorId, contact);
          if (!existingIds.has(contact.actorId) && !results.find(r => r.actorId === contact.actorId)) {
            results.push({
              actorId: contact.actorId,
              name: contact.name,
              email: contact.email,
              img: contact.customImg || null,
            });
          }
        }
      }
    }

    // Mark reachability using contact network field
    results = results.map(r => {
      const contact = contactsByActor.get(r.actorId);
      const contactNetwork = contact?.network?.toUpperCase() || '';
      let greyed = false;
      let unreachableLabel = null;

      if (contactNetwork && reachableIds.length > 0 && !reachableIds.includes(contactNetwork)) {
        greyed = true;
        unreachableLabel = `${contactNetwork} only`;
      }

      return {
        ...r,
        initials: getInitials(r.name),
        avatarColor: getAvatarColor(r.name),
        greyed,
        unreachableLabel,
      };
    });

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
          // Raw address — add as unverified recipient
          this._addRawRecipient(item.dataset.raw);
          this._closeAutocomplete();
          this.render(true);
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
    const div = document.createElement('div');
    div.innerHTML = this.body;
    return div.textContent || '';
  }

  /**
   * Prevent toolbar buttons from stealing focus from the editor.
   * On mousedown, call preventDefault — this keeps the editor selection alive
   * so execCommand has something to work with when the click fires.
   */
  _setupToolbarFocusGuard() {
    const toolbar = this.element?.querySelector('.ncm-composer__toolbar');
    if (!toolbar) return;

    toolbar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ncm-composer__tool')) {
        e.preventDefault();
      }
    });

    // Also guard overflow menu items
    const overflow = this.element?.querySelector('[data-id="overflow-menu"]');
    if (overflow) {
      overflow.addEventListener('mousedown', (e) => {
        if (e.target.closest('.ncm-composer__overflow-item')) {
          e.preventDefault();
        }
      });
    }
  }

  /**
   * Track editor formatting state and update toolbar button active classes.
   * Like Gmail: if cursor is in bold text, the bold button highlights.
   * Uses document.queryCommandState() on selectionchange.
   */
  _setupEditorStateTracking() {
    const editor = this.element?.querySelector('[data-id="editor-content"]');
    if (!editor) return;

    const updateActiveStates = () => {
      if (!this.element?.contains(document.activeElement)) return;

      // Direct command state queries
      const commands = {
        bold: 'bold',
        italic: 'italic',
        underline: 'underline',
        strikethrough: 'strikeThrough',
        bulletList: 'insertUnorderedList',
        numberList: 'insertOrderedList',
      };

      for (const [cmd, queryCmd] of Object.entries(commands)) {
        // Check both toolbar and overflow
        const btn = this.element?.querySelector(`.ncm-composer__tool[data-command="${cmd}"]`)
          || this.element?.querySelector(`.ncm-composer__overflow-item[data-command="${cmd}"]`);
        if (!btn) continue;
        try {
          const isActive = document.queryCommandState(queryCmd);
          btn.classList.toggle('ncm-composer__tool--active', isActive);
          btn.classList.toggle('ncm-composer__overflow-item--active', isActive);
        } catch { /* queryCommandState can throw */ }
      }

      // Link detection — check if cursor is inside an <a> tag
      const sel = window.getSelection();
      const anchorEl = sel?.anchorNode
        ? (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode)
        : null;

      const linkBtn = this.element?.querySelector('.ncm-composer__tool[data-command="link"]');
      if (linkBtn && anchorEl) {
        linkBtn.classList.toggle('ncm-composer__tool--active', !!anchorEl.closest('a'));
      }

      // Monospace — check if inside <pre> or <code>
      const codeBtn = this.element?.querySelector('.ncm-composer__tool[data-command="monospace"]');
      if (codeBtn && anchorEl) {
        const isInCode = !!(anchorEl.closest('pre') || anchorEl.closest('code'));
        codeBtn.classList.toggle('ncm-composer__tool--active', isInCode);
      }
    };

    document.addEventListener('selectionchange', updateActiveStates);
    editor.addEventListener('keyup', updateActiveStates);
    this._editorStateHandler = updateActiveStates;
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
    // Schedule time is handled by CyberTimePicker → hidden input
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

    const subjectInput = this.element?.querySelector('[data-id="subject-input"]');
    if (subjectInput) this.subject = subjectInput.value;

    // Save draft timestamp
    const now = new Date();
    this.autoSaveTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Update the auto-save indicator without full re-render
    const indicator = this.element?.querySelector('.ncm-composer__autosave');
    if (indicator) {
      indicator.innerHTML = `<i class="fas fa-check-circle"></i> Saved ${this.autoSaveTime}`;
    }

    // Persist draft to actor flags
    const actor = game.actors.get(this.fromActorId);
    if (actor?.isOwner || game.user.isGM) {
      const draftData = {
        mode: this.mode,
        recipients: this.recipients.map(r => ({ actorId: r.actorId, email: r.email, isRaw: r.isRaw || false })),
        subject: this.subject,
        body: this.body,
        priority: this.priority,
        encryptionEnabled: this.encryptionEnabled,
        encryptionDV: this.encryptionDV,
        encryptionType: this.encryptionType,
        encryptionFailureMode: this.encryptionFailureMode,
        encryptionMaxAttempts: this.encryptionMaxAttempts,
        iceSource: this.iceSource,
        iceActorId: this.iceActorId,
        encryptionBypassSkills: this.encryptionBypassSkills,
        selfDestructEnabled: this.selfDestructEnabled,
        selfDestructMode: this.selfDestructMode,
        savedAt: now.toISOString(),
      };
      actor.setFlag(MODULE_ID, 'composerDraft', draftData).catch(() => {});
    }
  }

  /**
   * Restore a previously auto-saved draft from actor flags.
   * Only restores for 'compose' mode (not reply/forward).
   */
  _restoreDraft() {
    if (this.mode !== 'compose') return;
    if (this.recipients.length > 0 || this.subject || this.body) return; // Already has content

    const actor = game.actors.get(this.fromActorId);
    if (!actor) return;

    const draft = actor.getFlag(MODULE_ID, 'composerDraft');
    if (!draft || !draft.savedAt) return;

    // Only restore if draft is < 24 hours old
    const age = Date.now() - new Date(draft.savedAt).getTime();
    if (age > 86400000) return;

    // Restore fields
    if (draft.recipients?.length) {
      for (const r of draft.recipients) {
        if (r.isRaw) {
          this._addRawRecipient(r.email);
        } else if (r.actorId) {
          this._addRecipient(r.actorId, false);
        }
      }
    }
    this.subject = draft.subject || '';
    this.body = draft.body || '';
    this.priority = draft.priority || 'normal';
    this.encryptionEnabled = draft.encryptionEnabled || false;
    this.encryptionDV = draft.encryptionDV || 12;
    this.encryptionType = draft.encryptionType || 'ICE';
    this.encryptionFailureMode = draft.encryptionFailureMode || 'nothing';
    this.encryptionMaxAttempts = draft.encryptionMaxAttempts || 0;
    this.iceSource = draft.iceSource || 'default';
    this.iceActorId = draft.iceActorId || null;
    this.encryptionBypassSkills = draft.encryptionBypassSkills || null;
    this.selfDestructEnabled = draft.selfDestructEnabled || false;
    this.selfDestructMode = draft.selfDestructMode || 'after_read';
  }

  /**
   * Clear the saved draft from actor flags (called after successful send).
   */
  async _clearDraft() {
    const actor = game.actors.get(this.fromActorId);
    if (actor && (actor.isOwner || game.user.isGM)) {
      await actor.unsetFlag(MODULE_ID, 'composerDraft').catch(() => {});
    }
  }

  // ─── GM Send-As (WP-4.5.6) ───────────────────────────────

  _renderSendAsList(filter = '') {
    const list = this.element?.querySelector('[data-id="sendas-list"]');
    if (!list) return;

    // Pull from GM Master Contact Directory (the authoritative NPC list)
    const masterService = game.nightcity?.masterContactService;
    const masterContacts = masterService?.getAll?.() || [];

    // Also include any actors with emails not in master (fallback)
    const masterActorIds = new Set(masterContacts.filter(c => c.actorId).map(c => c.actorId));
    const extraActors = game.actors.filter(a => {
      if (masterActorIds.has(a.id)) return false;
      return this.contactRepo?.getActorEmail(a.id);
    });

    // Build combined list: master contacts first, then extras
    const combined = [
      ...masterContacts.map(c => ({
        actorId: c.actorId || '',
        contactId: c.id || '',
        name: c.name,
        email: c.email,
        type: c.type || 'npc',
        org: c.organization || '',
        isMaster: true,
      })),
      ...extraActors.map(a => ({
        actorId: a.id,
        contactId: '',
        name: a.name,
        email: this.contactRepo?.getActorEmail(a.id) || '',
        type: a.type || '',
        org: '',
        isMaster: false,
      })),
    ];

    const q = filter.toLowerCase();
    const filtered = q
      ? combined.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.org.toLowerCase().includes(q))
      : combined;

    list.innerHTML = filtered.slice(0, 30).map(c => {
      const isActive = (c.actorId && c.actorId === this.fromActorId) || (c.contactId && c.contactId === this.fromContact?.id);
      const color = getAvatarColor(c.name);
      const initials = getInitials(c.name);
      return `
        <div class="ncm-sendas-item ${isActive ? 'ncm-sendas-item--active' : ''}"
             data-ncm-sendas-pick="${c.actorId}" data-ncm-contact-id="${c.contactId}">
          <div class="ncm-sendas-item__avatar" style="color: ${color};">${initials}</div>
          <div class="ncm-sendas-item__info">
            <div class="ncm-sendas-item__name">${c.name}${c.org ? ` <span style="color:var(--ncm-text-muted);font-size:0.85em;">— ${c.org}</span>` : ''}</div>
            <div class="ncm-sendas-item__email">${c.email}</div>
          </div>
          <span class="ncm-sendas-item__type">${c.isMaster ? 'MASTER' : c.type || 'NPC'}</span>
        </div>
      `;
    }).join('');
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

    // Disable send button directly (no re-render — preserves the overlay DOM)
    const sendBtn = this.element?.querySelector('[data-action="send"]');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.classList.add('ncm-composer__btn--disabled');
    }

    try {
      // Build recipient — handle actor, contact, and raw address recipients
      const actorRecipients = this.recipients.filter(r => r.actorId);
      const contactRecipients = this.recipients.filter(r => !r.actorId && r.contactId);
      const rawRecipients = this.recipients.filter(r => r.isRaw);
      const toActorId = actorRecipients.length === 1
        ? actorRecipients[0].actorId
        : actorRecipients.length > 1 ? actorRecipients.map(r => r.actorId) : null;

      const messageData = {
        toActorId: toActorId || null,
        toContactId: contactRecipients.length > 0 ? contactRecipients[0].contactId : undefined,
        to: rawRecipients.length > 0 ? rawRecipients[0].email
          : (contactRecipients.length > 0 ? contactRecipients[0].email : undefined),
        fromActorId: this.fromActorId || null,
        fromContactId: this.fromContact?.id || null,
        from: this.fromContact?.email || undefined,
        fromName: this.fromContact?.name || undefined,
        subject: this.subject,
        body: this.body,
        priority: this.priority,
        threadId: this.threadId,
        inReplyTo: this.inReplyTo,
        attachments: this.attachments.filter(a => !a.isEddies),
        eddies: this.eddiesAmount || 0,
      };

      // Encryption
      if (this.encryptionEnabled) {
        messageData.encryption = {
          type: this.encryptionType,
          dc: this.encryptionDV,
          failureMode: this.encryptionFailureMode || 'nothing',
          maxAttempts: this.encryptionMaxAttempts || 0,
          bypassSkills: this.encryptionBypassSkills || null,
        };
        // ICE config for BLACK_ICE / RED_ICE
        const isLethal = this.encryptionType === 'BLACK_ICE' || this.encryptionType === 'RED_ICE';
        if (isLethal && this.iceSource !== 'default') {
          messageData.encryption.ice = {
            source: this.iceSource,
            actorId: this.iceActorId || null,
          };
        }
        // Set failureMode to damage for lethal ICE by default
        if (isLethal && this.encryptionFailureMode === 'nothing') {
          messageData.encryption.failureMode = 'damage';
        }
        messageData.status = { encrypted: true };
      }

      // Self-destruct
      if (this.selfDestructEnabled) {
        messageData.selfDestruct = {
          mode: this.selfDestructMode,
          expiresAt: this._computeExpiry(),
        };
      }

      let result;

      // Deduct eddies from sender BEFORE sending (skip for contact-only senders)
      if (this.eddiesAmount > 0 && this.fromActorId) {
        const deducted = await this._deductEddies(this.fromActorId, this.eddiesAmount);
        if (!deducted) {
          this._sending = false;
          if (sendBtn) { sendBtn.disabled = false; sendBtn.classList.remove('ncm-composer__btn--disabled'); }
          return; // _deductEddies shows its own error
        }
      }

      // Show transmitting animation immediately
      await this._playSendAnimation('transmit');

      // Route through SchedulingService if schedule is enabled
      if (this.scheduleEnabled && this.scheduledTime) {
        let deliveryTime = this.scheduledTime;

        result = await this.schedulingService?.scheduleMessage(
          messageData,
          deliveryTime,
          { useGameTime: this.scheduleGameTime }
        );

        if (result?.success) {
          ui.notifications.info(`Message scheduled for delivery.`);
        }
      } else {
        // Immediate send
        result = await this.messageService?.sendMessage(messageData);
      }

      if (result?.success) {
        // Play success state
        this.soundService?.play?.('send');
        await this._playSendAnimation('success');

        // Credit eddies to recipient(s) on successful send
        if (this.eddiesAmount > 0 && actorRecipients.length > 0) {
          for (const r of actorRecipients) {
            await this._creditEddies(r.actorId, this.eddiesAmount);
          }
        }

        // Clear draft
        await this._clearDraft();

        this.close();
      } else {
        // Send failed — show failure animation with retry options
        if (this.eddiesAmount > 0) {
          await this._creditEddies(this.fromActorId, this.eddiesAmount);
        }
        await this._playSendAnimation('failure', { error: result?.error || 'Unknown transmission error' });
        // Don't close — user can retry/queue/draft from the overlay
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Send failed:`, error);
      // Refund eddies on exception too
      if (this.eddiesAmount > 0) {
        await this._creditEddies(this.fromActorId, this.eddiesAmount).catch(() => {});
      }
      await this._playSendAnimation('failure', { error: error.message || 'Unexpected transmission error' });
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

    // Auto-set failure mode for lethal ICE
    const isLethal = this.encryptionType === 'BLACK_ICE' || this.encryptionType === 'RED_ICE';
    if (isLethal && this.encryptionFailureMode === 'nothing') {
      this.encryptionFailureMode = 'damage';
    } else if (!isLethal) {
      this.encryptionFailureMode = 'nothing';
      this.iceSource = 'default';
      this.iceActorId = null;
    }
    this.render(true);
  }

  static _onSetFailureMode(event, target) {
    this.encryptionFailureMode = target.dataset.mode || 'nothing';
    this.render(true);
  }

  static _onSetIceSource(event, target) {
    this.iceSource = target.dataset.source || 'default';
    if (this.iceSource === 'default') this.iceActorId = null;
    this.render(true);
  }

  static _onSetIceActor(event, target) {
    this.iceActorId = target.dataset.actorId || null;
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
    // Pre-fill with current time + 1 hour when enabling
    if (this.scheduleEnabled && !this.scheduledTime) {
      const now = this.timeService?.getCurrentTime?.() || new Date().toISOString();
      const d = new Date(now);
      d.setHours(d.getHours() + 1);
      this.scheduledTime = d.toISOString();
    }
    this.render(true);
  }

  /** Open CyberTimePicker for the schedule delivery time */
  static _onOpenSchedulePicker(event, target) {
    const hiddenInput = this.element?.querySelector('[data-id="schedule-hidden"]');
    const triggerValue = target.querySelector('.ncm-ctp-trigger__value');

    CyberTimePicker.open({
      value: this.scheduledTime || '',
      title: 'Schedule Delivery',
      onSet: (iso, formatted) => {
        this.scheduledTime = iso;
        if (hiddenInput) hiddenInput.value = iso;
        if (triggerValue) {
          triggerValue.textContent = formatted;
          triggerValue.classList.remove('ncm-ctp-trigger__value--empty');
        }
      },
      onClear: () => {
        this.scheduledTime = '';
        if (hiddenInput) hiddenInput.value = '';
        if (triggerValue) {
          triggerValue.textContent = 'Pick a time...';
          triggerValue.classList.add('ncm-ctp-trigger__value--empty');
        }
      },
    });
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

  static _onSelectSendAs(event, target) {
    // Unused — handled by _setupSendAsList instead
  }

  /**
   * Attach a direct click listener on the send-as dropdown list.
   * Bypasses ApplicationV2's action system to avoid event conflicts.
   */
  _setupSendAsList() {
    const listEl = this.element?.querySelector('[data-id="sendas-list"]');
    if (!listEl || listEl._ncmBound) return;

    listEl.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      const item = e.target.closest('[data-ncm-sendas-pick]');
      if (!item) return;

      const actorId = item.dataset.ncmSendasPick || '';
      const contactId = item.dataset.ncmContactId || '';

      if (actorId) {
        // Actor-backed contact
        this.fromActorId = actorId;
        this.fromContact = null;
      } else if (contactId) {
        // Master contact without actor — use contact identity
        const mc = game.nightcity?.masterContactService?.getContact?.(contactId);
        if (mc) {
          this.fromActorId = null;
          this.fromContact = { id: mc.id, name: mc.name, email: mc.email, portrait: mc.portrait };
        }
      }

      this.sendAsDropdownOpen = false;
      this.render();
    }, true);

    listEl._ncmBound = true;
  }

  // ── CC ──

  static _onToggleCC(event, target) {
    this.ccFieldVisible = !this.ccFieldVisible;
    const ccField = this.element?.querySelector('[data-id="cc-field"]');
    if (ccField) {
      ccField.classList.toggle('ncm-hidden', !this.ccFieldVisible);
    }
  }

  // ── Overflow Menu ──

  static _onToggleOverflow(event, target) {
    const menu = this.element?.querySelector('[data-id="overflow-menu"]');
    if (!menu) return;
    const wasHidden = menu.classList.contains('ncm-hidden');
    menu.classList.toggle('ncm-hidden');

    // Close on outside click
    if (wasHidden) {
      const closeHandler = (e) => {
        if (!menu.contains(e.target) && e.target !== target) {
          menu.classList.add('ncm-hidden');
          document.removeEventListener('click', closeHandler, true);
        }
      };
      // Defer so the current click doesn't immediately close it
      requestAnimationFrame(() => {
        document.addEventListener('click', closeHandler, true);
      });
    }
  }

  // ── Retry Send ──

  static _onRetrySend(event, target) {
    // Reset overlay state — hide overlay, clear route active classes
    const overlay = this.element?.querySelector('[data-id="send-overlay"]');
    if (overlay) overlay.classList.add('ncm-hidden');

    // Reset route element active states
    const route = this.element?.querySelector('[data-id="send-route"]');
    if (route) {
      route.querySelectorAll('[class*="--active"]').forEach(el => {
        el.className = el.className.replace(/\s*ncm-composer__send-route-\w+--active/g, '');
      });
    }

    // Reset progress bar
    const progressBar = this.element?.querySelector('[data-id="send-progress-bar"]');
    if (progressBar) {
      progressBar.classList.remove('ncm-composer__send-progress-bar--animating');
      progressBar.style.width = '0';
    }

    this._sending = false;
    MessageComposerApp._onSend.call(this, event, target);
  }

  // ── Quote ──

  static _onToggleQuote(event, target) {
    const body = this.element?.querySelector('[data-id="original-msg-body"]');
    if (body) {
      body.classList.toggle('ncm-composer__msg-body--expanded');
      const fade = body.querySelector('.ncm-composer__msg-body-fade');
      if (fade) fade.style.display = body.classList.contains('ncm-composer__msg-body--expanded') ? 'none' : '';
      const icon = target.querySelector('i');
      if (icon) {
        icon.classList.toggle('fa-chevron-down');
        icon.classList.toggle('fa-chevron-up');
      }
      const text = body.classList.contains('ncm-composer__msg-body--expanded')
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
    // Foundry FilePicker for generic file attachments
    new FilePicker({
      type: 'any',
      callback: (path) => {
        const name = path.split('/').pop();
        this.attachments.push({
          name,
          size: '',
          icon: 'fa-paperclip',
          path,
          isEddies: false,
          encrypted: this.encryptionEnabled,
        });
        this.render(true);
      },
    }).render(true);
  }

  static _onAttachShard(event, target) {
    const actor = game.actors.get(this.fromActorId);
    const isGM = game.user.isGM;

    // Convert Foundry Items to plain objects for display
    const toShardEntry = (item, ownerName = '') => ({
      id: item.id,
      name: item.name,
      img: item.img,
      ownerName,
    });

    // Player: only their actor's inventory items with shard config
    // GM: actor inventory + all world items + all actors' inventories
    const actorShards = (actor?.items?.filter(i =>
      i.getFlag(MODULE_ID, 'shardConfig') || i.getFlag(MODULE_ID, 'config')
    ) || []).map(i => toShardEntry(i, actor.name));

    let allShards = [...actorShards];

    if (isGM) {
      // GM also sees world-level items
      const worldShards = (game.items?.filter(i =>
        i.getFlag(MODULE_ID, 'shardConfig') || i.getFlag(MODULE_ID, 'config')
      ) || []).map(i => toShardEntry(i, 'World'));
      allShards.push(...worldShards);

      // GM also sees shards on other actors
      for (const a of game.actors) {
        if (a.id === actor?.id) continue;
        const otherShards = (a.items?.filter(i =>
          i.getFlag(MODULE_ID, 'shardConfig') || i.getFlag(MODULE_ID, 'config')
        ) || []).map(i => toShardEntry(i, a.name));
        allShards.push(...otherShards);
      }
    }

    // Deduplicate by ID
    const seen = new Set();
    allShards = allShards.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    if (allShards.length === 0) {
      ui.notifications.info(isGM
        ? 'No data shards found in any inventory or world items.'
        : 'No data shards in your inventory.');
      return;
    }

    // Build selection dialog
    const content = `<div style="max-height:200px;overflow-y:auto;">
      ${allShards.map(s => `
        <div style="display:flex;align-items:center;gap:8px;padding:4px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.1);"
             class="ncm-shard-pick" data-item-id="${s.id}">
          <i class="fas fa-microchip" style="color:var(--ncm-secondary);"></i>
          <span>${s.name}</span>
          ${s.ownerName ? `<span style="font-size:0.7em;color:var(--ncm-text-muted);margin-left:auto;">(${s.ownerName})</span>` : ''}
        </div>
      `).join('')}
    </div>`;

    new Dialog({
      title: 'Attach Data Shard',
      content,
      buttons: { cancel: { label: 'Cancel' } },
      render: (html) => {
        html.find('.ncm-shard-pick').on('click', (e) => {
          const itemId = e.currentTarget.dataset.itemId;
          const item = allShards.find(s => s.id === itemId);
          if (!item) return;

          // Prevent duplicate
          if (this.attachments.find(a => a.itemId === itemId)) {
            ui.notifications.warn('Shard already attached.');
            return;
          }

          this.attachments.push({
            name: `${item.name}.shard`,
            size: '',
            icon: 'fa-microchip',
            itemId: item.id,
            isEddies: false,
            encrypted: this.encryptionEnabled,
          });
          this.render(true);

          // Close dialog
          const app = Object.values(ui.windows).find(w => w.title === 'Attach Data Shard');
          app?.close();
        });
      },
    }).render(true);
  }

  static _onAttachEddies(event, target) {
    const actor = game.actors.get(this.fromActorId);
    const isGM = game.user.isGM;

    // CPR system: confirmed path is system.wealth.value + system.wealth.transactions
    const currentEddies = actor?.system?.wealth?.value ?? 0;

    const balanceText = isGM
      ? `GM Mode — no balance restriction${currentEddies > 0 ? ` (actor has ${currentEddies.toLocaleString()} eb)` : ''}`
      : `You have ${currentEddies.toLocaleString()} eb`;

    const content = `<div class="form-group">
      <label style="margin-bottom:4px;">${balanceText}</label>
      <label>Amount to send:</label>
      <input type="number" name="amount" value="100" min="1" style="width:100%;" />
    </div>`;

    new Dialog({
      title: 'Attach Eddies',
      content,
      buttons: {
        attach: {
          label: 'Attach',
          callback: (html) => {
            const amount = parseInt(html.find('[name=amount]').val()) || 0;
            if (amount <= 0) return;

            // Players must have sufficient funds; GM can send any amount
            if (!isGM && amount > currentEddies) {
              ui.notifications.warn(`Insufficient eddies. You have ${currentEddies.toLocaleString()} eb.`);
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
          },
        },
        cancel: { label: 'Cancel' },
      },
      default: 'attach',
    }).render(true);
  }

  // ── Editor Commands ──

  static _onEditorCommand(event, target) {
    const command = target.dataset.command;
    if (!command) return;

    // Focus the editor first so execCommand works on the right context
    const editor = this.element?.querySelector('[data-id="editor-content"]');
    if (editor && document.activeElement !== editor) editor.focus();

    switch (command) {
      case 'bold':
        document.execCommand('bold', false);
        break;
      case 'italic':
        document.execCommand('italic', false);
        break;
      case 'underline':
        document.execCommand('underline', false);
        break;
      case 'strikethrough':
        document.execCommand('strikeThrough', false);
        break;
      case 'monospace': {
        // Toggle <code> wrap on selection — if already in code, unwrap; otherwise wrap
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) break;
        const anchorNode = sel.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
        const existingCode = anchorNode?.closest('code');
        if (existingCode) {
          // Unwrap — replace <code> with its text content
          const text = document.createTextNode(existingCode.textContent);
          existingCode.parentNode.replaceChild(text, existingCode);
          // Re-select the text
          const range = document.createRange();
          range.selectNodeContents(text);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          // Wrap selection in <code>
          const selectedText = sel.toString();
          document.execCommand('insertHTML', false,
            `<code style="font-family:'Share Tech Mono',monospace;background:rgba(25,243,247,0.06);padding:1px 4px;border-radius:2px;color:#19f3f7;">${selectedText}</code>`
          );
        }
        break;
      }
      case 'link':
        // Use Foundry Dialog instead of prompt()
        this._showLinkDialog();
        break;
      case 'unlink':
        document.execCommand('unlink', false);
        break;
      case 'bulletList':
        document.execCommand('insertUnorderedList', false);
        break;
      case 'numberList':
        document.execCommand('insertOrderedList', false);
        break;
      case 'blockquote':
        document.execCommand('formatBlock', false, 'blockquote');
        break;
      case 'horizontalRule':
        document.execCommand('insertHorizontalRule', false);
        break;
      case 'clearFormat':
        document.execCommand('removeFormat', false);
        document.execCommand('formatBlock', false, 'div');
        break;
      case 'lock': {
        // Encrypted block — wrap selected text in a styled container
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          const range = selection.getRangeAt(0);
          const wrapper = document.createElement('div');
          wrapper.className = 'ncm-encrypted-text-block';
          wrapper.setAttribute('data-label', 'ICE-ENCRYPTED');
          range.surroundContents(wrapper);
        } else {
          // No selection — insert an empty encrypted block
          document.execCommand('insertHTML', false,
            '<div class="ncm-encrypted-text-block" data-label="ICE-ENCRYPTED"><br></div><div><br></div>'
          );
        }
        break;
      }
      default:
        break;
    }

    // Update body state
    if (editor) this.body = editor.innerHTML;
  }

  /**
   * Show a Foundry Dialog for inserting a link (prompt() is blocked in Foundry).
   */
  _showLinkDialog() {
    const selectedText = window.getSelection()?.toString() || '';

    new Dialog({
      title: 'Insert Link',
      content: `
        <div class="form-group" style="margin-bottom:8px;">
          <label>URL:</label>
          <input type="text" name="url" value="https://" style="width:100%;" />
        </div>
        ${!selectedText ? `
        <div class="form-group">
          <label>Link text:</label>
          <input type="text" name="text" placeholder="Click here" style="width:100%;" />
        </div>` : ''}
      `,
      buttons: {
        insert: {
          label: 'Insert',
          callback: (html) => {
            const url = html.find('[name=url]').val()?.trim();
            if (!url || url === 'https://') return;

            const editor = this.element?.querySelector('[data-id="editor-content"]');
            if (editor) editor.focus();

            if (selectedText) {
              document.execCommand('createLink', false, url);
            } else {
              const text = html.find('[name=text]').val()?.trim() || url;
              document.execCommand('insertHTML', false, `<a href="${url}">${text}</a>`);
            }

            if (editor) this.body = editor.innerHTML;
          },
        },
        cancel: { label: 'Cancel' },
      },
      default: 'insert',
    }).render(true);
  }

  // ── Message Insert Actions ──

  static _onInsertTimestamp(event, target) {
    const editor = this.element?.querySelector('[data-id="editor-content"]');
    if (!editor) return;
    editor.focus();

    // Get game time if available, otherwise real time
    let timeStr;
    if (this.timeService) {
      const gameTime = this.timeService.getCurrentTime();
      const dt = new Date(gameTime);
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const yyyy = dt.getFullYear();
      const hh = String(dt.getHours()).padStart(2, '0');
      const min = String(dt.getMinutes()).padStart(2, '0');
      timeStr = `${dd}.${mm}.${yyyy} // ${hh}:${min}`;
    } else {
      const now = new Date();
      timeStr = now.toLocaleString();
    }

    document.execCommand('insertHTML', false,
      `<span class="ncm-timestamp-tag" style="color:var(--ncm-secondary);font-family:var(--ncm-font-mono);font-size:0.9em;">[ ${timeStr} ]</span>&nbsp;`
    );
    this.body = editor.innerHTML;
  }

  static _onInsertCoords(event, target) {
    const editor = this.element?.querySelector('[data-id="editor-content"]');
    if (!editor) return;

    // Get current scene name as location context
    const sceneName = game.scenes?.viewed?.name || 'Unknown Location';

    new Dialog({
      title: 'Insert Location Tag',
      content: `
        <div class="form-group" style="margin-bottom:8px;">
          <label>Location:</label>
          <input type="text" name="location" value="${sceneName}" style="width:100%;" />
        </div>
        <div class="form-group">
          <label>Grid Reference (optional):</label>
          <input type="text" name="grid" placeholder="e.g. Watson-NID-7" style="width:100%;" />
        </div>
      `,
      buttons: {
        insert: {
          label: 'Insert',
          callback: (html) => {
            const location = html.find('[name=location]').val()?.trim();
            const grid = html.find('[name=grid]').val()?.trim();
            if (!location) return;

            editor.focus();
            const tag = grid
              ? `📍 ${location} [${grid}]`
              : `📍 ${location}`;
            document.execCommand('insertHTML', false,
              `<span class="ncm-location-tag" style="color:var(--ncm-warning);font-family:var(--ncm-font-mono);font-size:0.9em;">[ ${tag} ]</span>&nbsp;`
            );
            this.body = editor.innerHTML;
          },
        },
        cancel: { label: 'Cancel' },
      },
      default: 'insert',
    }).render(true);
  }

  static _onInsertSignature(event, target) {
    const editor = this.element?.querySelector('[data-id="editor-content"]');
    if (!editor) return;
    editor.focus();

    const actor = game.actors.get(this.fromActorId);
    const name = actor?.name || this.fromContact?.name || 'Unknown';
    const email = actor ? (this.contactRepo?.getActorEmail(this.fromActorId) || '') : (this.fromContact?.email || '');
    const alias = actor?.system?.information?.alias || '';

    const sigLine = alias
      ? `— ${alias} // ${email}`
      : `— ${name} // ${email}`;

    document.execCommand('insertHTML', false,
      `<br><div class="ncm-signature" style="border-top:1px solid var(--ncm-border);padding-top:6px;margin-top:8px;color:var(--ncm-text-muted);font-family:var(--ncm-font-mono);font-size:0.85em;font-style:italic;">${sigLine}</div>`
    );
    this.body = editor.innerHTML;
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

    const schedule = el.querySelector('[data-id="schedule-hidden"]');
    if (schedule && schedule.value) {
      // Hidden input stores ISO directly from CyberTimePicker
      this.scheduledTime = schedule.value;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────

  _getDefaultFromActor() {
    if (game.user.character) return game.user.character.id;
    const owned = game.actors?.find(a => a.isOwner);
    return owned?.id || null;
  }

  // ─── Eddies Transfer (CPR Wealth System) ────────────────

  /**
   * Deduct eddies from an actor's wealth using CPR's transaction ledger.
   * CPR stores wealth at system.wealth.value with system.wealth.transactions[].
   * @param {string} actorId
   * @param {number} amount
   * @returns {Promise<boolean>} true if successful
   */
  async _deductEddies(actorId, amount) {
    const actor = game.actors.get(actorId);
    if (!actor) {
      ui.notifications.error('Sender actor not found.');
      return false;
    }

    const currentWealth = actor.system?.wealth?.value ?? 0;
    const isGM = game.user.isGM;

    // GM bypasses balance check (can send from NPC accounts with 0 balance)
    if (!isGM && amount > currentWealth) {
      ui.notifications.error(`Insufficient eddies. You have ${currentWealth.toLocaleString()} eb.`);
      return false;
    }

    try {
      // CPR system: deepClone wealth, push [description, reason] array
      const wealth = foundry.utils.deepClone(actor.system.wealth);
      wealth.value = Math.max(0, wealth.value - amount);
      const transaction = `Decreased by ${amount} to ${wealth.value}`;
      const reason = `NCM: Sent ${amount.toLocaleString()} eb via message`;
      wealth.transactions.push([transaction, reason]);

      // Update actor — need GM permission, use socket if player
      if (actor.isOwner || isGM) {
        await actor.update({ 'system.wealth': wealth });
      } else {
        ui.notifications.warn('Cannot update wealth — no permission on actor.');
        return false;
      }

      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Eddies deduction failed:`, error);
      ui.notifications.error('Failed to deduct eddies from account.');
      return false;
    }
  }

  /**
   * Credit eddies to a recipient actor's wealth.
   * This runs on the GM client (via the send flow) since the GM has write
   * permission on all actors. Players sending to NPCs goes through the
   * GM socket relay in MessageService.
   * @param {string} actorId
   * @param {number} amount
   */
  async _creditEddies(actorId, amount) {
    const actor = game.actors.get(actorId);
    if (!actor) return;

    try {
      const wealth = foundry.utils.deepClone(actor.system.wealth);
      wealth.value += amount;
      const transaction = `Increased by ${amount} to ${wealth.value}`;
      const reason = `NCM: Received ${amount.toLocaleString()} eb via message`;
      wealth.transactions.push([transaction, reason]);

      if (actor.isOwner || game.user.isGM) {
        await actor.update({ 'system.wealth': wealth });
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Eddies credit failed:`, error);
    }
  }

  // ─── Send Animation ────────────────────────────────────────

  /**
   * Play the full send animation overlay:
   * 1. Show transmitting overlay with route + progress
   * 2. On success: swap to success state, auto-close after delay
   * 3. On failure: swap to failure state with retry/queue/draft buttons
   * @param {boolean} [success=true]
   * @param {Object} [details={}]
   */
  /**
   * Play send animation overlay in stages.
   * @param {'transmit'|'success'|'failure'} state
   * @param {Object} [details={}] — { error: string } for failure state
   */
  async _playSendAnimation(state, details = {}) {
    const el = this.element;
    if (!el) return;

    const overlay = el.querySelector('[data-id="send-overlay"]');
    const transmit = el.querySelector('[data-id="send-transmit"]');
    const successEl = el.querySelector('[data-id="send-success"]');
    const failureEl = el.querySelector('[data-id="send-failure"]');
    if (!overlay) return;

    const netName = this.networkService?.currentNetwork?.name?.toUpperCase() || 'CITINET';
    const recipientName = this.recipients.length > 0 ? this.recipients[0].name : '—';

    if (state === 'transmit') {
      // ─── Show transmitting overlay ───
      // Populate route info
      const routeNet = el.querySelector('[data-id="send-route-net"]');
      const routeTo = el.querySelector('[data-id="send-route-to"]');
      if (routeNet) routeNet.textContent = netName;
      if (routeTo) routeTo.textContent = recipientName;

      // Populate stream data
      const stream = el.querySelector('[data-id="send-stream"]');
      if (stream) {
        const encLabel = this.encryptionEnabled ? `ICE DV${this.encryptionDV}` : 'NONE';
        const sig = this.networkService?.signalStrength ?? 100;
        stream.innerHTML = `PKT 0x${Math.random().toString(16).slice(2, 6).toUpperCase()} → NODE_${String(Math.floor(Math.random() * 20)).padStart(2, '0')} → RELAY<br>ENC: ${encLabel} · SIG: ${sig}% · PRI: ${this.priority.toUpperCase()}<br>ROUTE: LOCAL → ${netName}_CORE → DEST`;
      }

      // Show overlay with transmitting state
      overlay.classList.remove('ncm-hidden');
      if (transmit) transmit.classList.remove('ncm-hidden');
      if (successEl) successEl.classList.add('ncm-hidden');
      if (failureEl) failureEl.classList.add('ncm-hidden');

      // Start progress bar animation
      const progressBar = el.querySelector('[data-id="send-progress-bar"]');
      if (progressBar) {
        progressBar.style.width = '0';
        requestAnimationFrame(() => {
          progressBar.classList.add('ncm-composer__send-progress-bar--animating');
        });
      }

      // Sequential route animation
      const route = el.querySelector('[data-id="send-route"]');
      if (route) {
        const steps = Array.from(route.children);
        const stepDelay = 250;
        for (let i = 0; i < steps.length; i++) {
          await new Promise(r => setTimeout(r, stepDelay));
          const child = steps[i];
          if (child.classList.contains('ncm-composer__send-route-label') || child.dataset?.id === 'send-route-net') {
            child.classList.add('ncm-composer__send-route-label--active');
          } else if (child.classList.contains('ncm-composer__send-route-dot')) {
            child.classList.add('ncm-composer__send-route-dot--active');
          } else if (child.classList.contains('ncm-composer__send-route-line')) {
            child.classList.add('ncm-composer__send-route-line--active');
          } else if (child.classList.contains('ncm-composer__send-route-target') || child.dataset?.id === 'send-route-to') {
            child.classList.add('ncm-composer__send-route-target--active');
          }
        }
      }

      // Brief hold after route completes
      await new Promise(r => setTimeout(r, 300));

    } else if (state === 'success') {
      // ─── Swap to success state ───
      if (transmit) transmit.classList.add('ncm-hidden');
      if (successEl) {
        successEl.classList.remove('ncm-hidden');
        const detail = el.querySelector('[data-id="send-success-detail"]');
        if (detail) {
          const time = formatCyberDate(this.timeService?.getCurrentTime?.() || new Date().toISOString());
          detail.textContent = `Delivered to ${recipientName} via ${netName} · ${time}`;
        }
      }
      // Hold for user to see success
      await new Promise(r => setTimeout(r, 1500));

    } else if (state === 'failure') {
      // ─── Swap to failure state ───
      if (transmit) transmit.classList.add('ncm-hidden');
      if (failureEl) {
        failureEl.classList.remove('ncm-hidden');
        const detail = el.querySelector('[data-id="send-fail-detail"]');
        if (detail) {
          detail.textContent = details.error || 'ERR_NET_TIMEOUT · Node relay unresponsive';
        }
      }
      // Don't auto-close — user picks retry/queue/draft
    }
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
