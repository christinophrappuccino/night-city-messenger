/**
 * Message Composer Application — Sprint 4.5 Redesign
 * @file scripts/ui/MessageComposer/MessageComposerApp.js
 * @module night-city-messenger
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

import { MODULE_ID, EVENTS, SEND_AS_FLAG } from '../../utils/constants.js';
import { pickSenderChoice } from '../../utils/identities.js';
import { getInitials, getAvatarColor } from '../../utils/designHelpers.js';
import { formatCyberDate, normalizeAnonStyle, ANON_DEFAULT_ALIAS, ANON_MASKED_EMAIL, resolveDisplayName, resolveDisplayPortrait, resolveOperator, isHiddenCharacter, isSelectableCharacter } from '../../utils/helpers.js';
import { CyberTimePicker } from '../components/CyberTimePicker.js';
import { applyGmView, applyAdminZoom, toggleGmView, playerDialog, adminPrompt, adminConfirm } from '../../utils/adminTheme.js';
import { pasteToHtml } from '../../utils/richText.js';
import { shardTerm as T } from '../../utils/shardTerm.js';
import { tagHueIndex } from '../../utils/tagHue.js';
import { showNamePicker } from '../../utils/namePicker.js';
import { DRAFTS_FLAG, newDraftId, readDrafts, pruneDrafts, draftRecipientName, draftLabel, draftKind, draftHasContent, relativeAge } from '../../utils/drafts.js';
import { buildPreview } from './previewModel.js';

/** A name's category hue — defined by the admin presets, else the act colour. */
const hueVar = (name) => `var(--ncm-hue-${tagHueIndex(name) || 1}, var(--ncm-secondary))`;

const PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent', critical: 'Critical' };
const PRIORITY_TONES = { low: 'hint', normal: 'act', high: 'attn', urgent: 'attn', critical: 'bad' };
const SD_LABELS = { after_read: 'after reading', '1h': 'in 1 h', '6h': 'in 6 h', '24h': 'in 24 h' };
const ENC_TYPE_LABELS = { ICE: 'Standard', RED_ICE: 'Red ICE', BLACK_ICE: 'Black ICE' };
const ANON_STYLE_LABELS = { filtered: 'Filtered', scrambled: 'Scrambled', ghost: 'Ghost', monolith: 'Monolith' };

export class MessageComposerApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {

  // ─── Static Configuration ─────────────────────────────────

  /**
   * GM-view toggle (admin theme for readability). The composer does NOT
   * extend BaseApplication, so the same hooks BaseApplication provides are
   * wired here by hand — keep them in step with BaseApplication.
   */
  static GM_VIEW_TOGGLE = true;

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
      toggleAnonymous: MessageComposerApp._onToggleAnonymous,
      setAnonStyle: MessageComposerApp._onSetAnonStyle,
      toggleAnonReplies: MessageComposerApp._onToggleAnonReplies,
      toggleSchedule: MessageComposerApp._onToggleSchedule,
      toggleSendAs: MessageComposerApp._onToggleSendAs,
      toggleCC: MessageComposerApp._onToggleCC,
      toggleQuote: MessageComposerApp._onToggleQuote,
      toggleOverflow: MessageComposerApp._onToggleOverflow,
      openSchedulePicker: MessageComposerApp._onOpenSchedulePicker,
      toggleNetPicker: MessageComposerApp._onToggleNetPicker,
      pickSendDate: MessageComposerApp._onPickSendDate,
      retrySend: MessageComposerApp._onRetrySend,
      removeRecipient: MessageComposerApp._onRemoveRecipient,
      removeAttachment: MessageComposerApp._onRemoveAttachment,
      attachFile: MessageComposerApp._onAttachFile,
      attachMedia: MessageComposerApp._onAttachMedia,
      attachShard: MessageComposerApp._onAttachShard,
      attachEddies: MessageComposerApp._onAttachEddies,
      editorCommand: MessageComposerApp._onEditorCommand,
      insertTimestamp: MessageComposerApp._onInsertTimestamp,
      insertCoords: MessageComposerApp._onInsertCoords,
      // The clean revision (2026-10-28): one drawer, preview, drafts, templates.
      toggleDrawer: MessageComposerApp._onToggleDrawer,
      togglePreview: MessageComposerApp._onTogglePreview,
      openDrafts: MessageComposerApp._onOpenDrafts,
      toggleTemplates: MessageComposerApp._onToggleTemplates,
      tplInsert: MessageComposerApp._onTplInsert,
      tplSave: MessageComposerApp._onTplSave,
      tplImport: MessageComposerApp._onTplImport,
      tplExport: MessageComposerApp._onTplExport,
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

  // GM per-message overrides (header pills). Players never set these — their
  // network pill is a real connection switch, their date chip is display-only.
  /** @type {string|null} Network id this message goes out via (null = my connection) */
  sendNetworkId = null;
  /** @type {string} Backdated ISO stamp ('' = now) — always in the past */
  sendTimestamp = '';
  /** @type {{unsubscribe: Function}|null} */
  _netChangedHandle = null;

  // Attachments
  /** @type {Array<{name: string, size: string, icon: string, itemId?: string, encrypted: boolean, isEddies: boolean, eddiesAmount?: number, eddiesFormatted?: string}>} */
  attachments = [];

  // Eddies
  /** @type {number} */
  eddiesAmount = 0;

  // GM Send-As
  /** @type {boolean} */
  sendAsDropdownOpen = false;

  // Anonymous Send (GM only) — masks the sender; real identity is stored GM-side
  // only (truly hidden). Defaults seeded from world settings in the constructor.
  /** @type {boolean} */
  anonymousEnabled = false;
  /** @type {string} 'filtered' | 'scrambled' | 'ghost' | 'monolith' */
  anonStyle = 'scrambled';
  /** @type {string} Display alias (blank → 'UNKNOWN') */
  anonAlias = '';
  /** @type {boolean} Whether the recipient can reply (routes back masked) */
  anonAllowReplies = true;
  /** @type {number} Trace difficulty to unmask (GM override of the default DV) */
  anonTraceDV = 15;

  /** @type {Object|null} Anonymous-reply descriptor when replying to masked mail
   *   — { parentMessageId, alias, style, maskedEmail }. The real target is hidden;
   *   the GM resolves it at delivery. */
  anonReplyTo = null;

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

  // The clean revision (2026-10-28)
  /** @type {string|null} the ONE open delivery drawer: 'pri'|'enc'|'sd'|'anon'|'sched' */
  _drawer = null;
  /** @type {boolean} GM: the form is swapped for what the recipient will open */
  _preview = false;
  /** @type {string|null} this window's draft id (minted on the first autosave) */
  _draftId = null;
  /** @type {string|null} a draft to open on the first render (composeMessage({ draftId })) */
  _pendingDraftId = null;
  /** @type {boolean} the message went out (or was saved on purpose) — close() must not autosave it again */
  _draftDone = false;
  /** @type {Function|null} outside-click closer for the templates menu */
  _tplCloser = null;

  // ─── Service Accessors ────────────────────────────────────

  get messageService() { return game.nightcity?.messageService; }
  get contactRepo() { return game.nightcity?.contactRepository; }
  // The composer does NOT extend BaseApplication, so its service getters live here.
  get contactGroupService() { return game.nightcity?.contactGroupService; }
  get networkService() { return game.nightcity?.networkService; }
  get soundService() { return game.nightcity?.soundService; }
  get eventBus() { return game.nightcity?.eventBus; }
  get schedulingService() { return game.nightcity?.schedulingService; }
  get timeService() { return game.nightcity?.timeService; }
  get messageTemplateService() { return game.nightcity?.messageTemplateService; }

  // ─── Constructor ──────────────────────────────────────────

  constructor(options = {}) {
    const instanceId = foundry.utils.randomID(8);
    super(foundry.utils.mergeObject(options, {
      id: `ncm-message-composer-${instanceId}`,
    }));

    this.mode = options.mode || 'compose';
    // SEND AS A TERMINAL ACCOUNT — {itemUuid, accountId, username, machine}.
    // The sender is the account's identity (locked), the To search is its
    // address book, and eddies can't be attached (it isn't your money).
    this.terminalSend = options.terminalSend || null;
    this.addressBook = Array.isArray(options.addressBook) ? options.addressBook : [];

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
    // A draft opened on purpose. A fresh composer never restores one by itself.
    this._pendingDraftId = options.draftId || null;

    if (this.mode === 'reply' && this.originalMessage) this._initReply(options);
    else if (this.mode === 'forward' && this.originalMessage) this._initForward();
    else this._initCompose(options);

    // A reply keeps the address the mail reached; a draft brings back its own.
    if (this.mode !== 'reply' && !this._pendingDraftId) this._applyDefaultSender();

    // Priority applies to all modes
    if (options.priority) this.priority = options.priority;

    // Seed Anonymous Send defaults from world settings (GM only).
    if (game.user.isGM) {
      try {
        this.anonStyle = game.settings.get(MODULE_ID, 'anonDefaultStyle') || 'scrambled';
        this.anonAllowReplies = game.settings.get(MODULE_ID, 'anonAllowRepliesDefault') ?? true;
        this.anonTraceDV = Number(game.settings.get(MODULE_ID, 'anonTraceDV')) || 15;
      } catch { /* settings not ready — keep field defaults */ }
    }

    // GM replying within an anonymous thread — pre-tick Anonymous Send and carry the
    // thread's original masking config (alias/style/replies/traceDV) so the
    // conversation stays anonymous by default. Left toggleable: the GM can turn it
    // off for any given reply via the composer toggle.
    this._preTickAnonThread();

    // Keep the network pill honest when the connection changes elsewhere (the
    // inbox selector, a scene change). Only THIS client's switches — socket
    // echoes of other users' switches carry source:'socket' and don't move us.
    this._netChangedHandle = this.eventBus?.on?.(EVENTS.NETWORK_CHANGED, (data) => {
      if (data?.source === 'socket' || !this.rendered || this._sending) return;
      this.render();
    }) ?? null;
  }

  /** GM reply inside an anonymous thread → Anonymous pre-ticked with the thread's mask. */
  _preTickAnonThread() {
    if (game.user.isGM && this.mode === 'reply' && this.originalMessage
        && this._isAnonFeatureEnabled()) {
      const cfg = this.messageService?.getThreadAnonConfig(this.originalMessage);
      if (cfg) {
        this.anonymousEnabled = true;
        this.anonStyle = cfg.style;
        this.anonAlias = cfg.alias;
        this.anonAllowReplies = cfg.allowReplies;
        this.anonTraceDV = cfg.traceDV;
      }
    }
  }

  /** Reply setup — the locked chip(s), subject, thread fields, inherited encryption. */
  _initReply(options = {}) {
    {
      const reply = this.messageService?.buildReply(this.originalMessage, this.fromActorId, '', { all: !!options.replyAll, fromContactId: this.fromContact?.id || null });
      if (reply) {
        if (reply.anonReply) {
          // Replying to an anonymous message — the real target is hidden. Show a
          // locked masked recipient chip; the GM resolves + delivers on send.
          this.anonReplyTo = reply.anonReply;
          const alias = reply.anonReply.alias || 'UNKNOWN';
          this.recipients.push({
            actorId: null,
            contactId: null,
            name: alias,
            email: reply.anonReply.maskedEmail || '',
            avatarColor: getAvatarColor(alias),
            initials: '?',
            mismatch: false,
            mismatchTooltip: '',
            unreachable: false,
            locked: true,
            isRaw: false,
            isAnonTarget: true,
          });
          this.subject = reply.subject;
          this.threadId = reply.threadId;
          this.inReplyTo = reply.inReplyTo;
        } else if (reply.recipients?.length) {
          // Reply All — every participant but me. Chips stay removable so the
          // player can drop someone from the answer.
          for (const r of reply.recipients) {
            if (r.actorId) this._addRecipient(r.actorId, false);
            else if (r.contactId || r.email) this._addContactRecipient({ contactId: r.contactId || null, email: r.email || '', name: r.name || r.email });
          }
          this.subject = reply.subject;
          this.threadId = reply.threadId;
          this.inReplyTo = reply.inReplyTo;
        } else if (reply.toActorId) {
          this._addRecipient(reply.toActorId, true, reply.toContactId ? { contactId: reply.toContactId, email: reply.to } : null);
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
        // Mail that reached one of my identities is answered FROM that identity.
        if (reply.fromContactId && this.fromContact?.id !== reply.fromContactId) {
          const mc = game.nightcity?.masterContactService?.getContact?.(reply.fromContactId);
          if (mc) this.fromContact = { id: mc.id, name: mc.name, email: mc.email, portrait: mc.portrait };
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
    }
  }

  /** Forward setup — subject + quoted body from the service. */
  _initForward() {
    const fwd = this.messageService?.buildForward(this.originalMessage, this.fromActorId, '', '');
    if (fwd) {
      this.subject = fwd.subject;
      this.body = fwd.body;
    }
  }

  /** New message setup — pre-filled recipient / subject / body from the launcher. */
  _initCompose(options = {}) {
    {
      if (options.groupId) this._addGroupById(options.groupId);
      if (options.toActorId) this._addRecipient(options.toActorId, false);
      // Fallback: if actor-based add failed or no actorId, try raw email
      if (this.recipients.length === 0 && options.to) {
        const email = options.to.trim();
        if (!this.recipients.find(r => r.email === email)) {
          const hasName = !!options.toName;
          const displayName = options.toName || email;
          this.recipients.push({
            actorId: null,
            name: displayName,
            email,
            avatarColor: getAvatarColor(displayName),
            initials: hasName ? getInitials(displayName) : '@',
            mismatch: false,
            mismatchTooltip: '',
            unreachable: false,
            locked: false,
            isRaw: !hasName,
          });
          if (this._errors.to) delete this._errors.to;
        }
      }
      this.subject = options.subject || '';
      this.body = options.body || '';
      this.threadId = options.threadId || null;
      this.inReplyTo = options.inReplyTo || null;
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────

  async _prepareContext(options) {
    // A draft opened on purpose lands before the first paint (reply drafts load
    // their original through the repository, which is async).
    await this._loadPendingDraft();
    const ns = this.networkService;
    // GM "send via" override: the pill (and everything keyed off the network)
    // describes the network THIS MESSAGE goes out on, not the GM's connection.
    const viaNetwork = (game.user.isGM && this.sendNetworkId) ? (ns?.getNetwork?.(this.sendNetworkId) ?? null) : null;
    if (game.user.isGM && this.sendNetworkId && !viaNetwork) this.sendNetworkId = null; // network deleted
    const network = viaNetwork || ns?.currentNetwork;
    const isDeadZone = viaNetwork ? false : (ns?.isDeadZone ?? false);
    const signalStrength = viaNetwork ? (viaNetwork.signalStrength ?? 100) : (ns?.signalStrength ?? 100);
    const networkName = isDeadZone ? 'DEAD ZONE' : (network?.name?.toUpperCase() || 'OFFLINE');
    const networkThemeColor = isDeadZone ? null : (network?.theme?.color || null);

    // From actor — or master contact fallback
    const fromActor = this.fromActorId ? game.actors.get(this.fromActorId) : null;
    const fromEmail = this._fromEmail();
    // Explicit master-contact pick → its name; else directory-by-actor → actor label.
    const fromName = this.fromContact?.name
      || this._mainSenderName()
      || (fromActor ? resolveDisplayName({ actorId: this.fromActorId, email: fromEmail }, fromActor.name) : 'Unknown');
    const fromAvatarColor = getAvatarColor(fromName);

    const isGM = game.user.isGM;
    const isGMSendAs = isGM && (this.fromContact || this.fromActorId !== this._getDefaultFromActor());
    const sendChoices = this._senderChoices();
    const fromIsAlias = sendChoices.some(c => !c.isMain && c.id === this.fromContact?.id);

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

    // Priorities / self-destruct / lock type — the drawer segments
    const priorities = Object.entries(PRIORITY_LABELS).map(([id, label]) => ({ id, label, active: this.priority === id }));
    const selfDestructOptions = Object.entries(SD_LABELS).map(([id, label]) => ({ id, label, active: this.selfDestructMode === id }));
    const encTypes = Object.entries(ENC_TYPE_LABELS).map(([id, label]) => ({ id, label, active: this.encryptionType === id }));
    const isLethalICE = this.encryptionType === 'BLACK_ICE' || this.encryptionType === 'RED_ICE';
    const lockLabel = !this.encryptionEnabled ? 'Open' : (this.encryptionType === 'ICE' ? 'ICE' : ENC_TYPE_LABELS[this.encryptionType]);
    const lockTone = this.encryptionEnabled && isLethalICE ? 'bad' : 'secret';

    // Original message card (reply/forward) — full rendered card data
    let originalMessageCard = null;
    if ((this.mode === 'reply' || this.mode === 'forward') && this.originalMessage) {
      const orig = this.originalMessage;
      const senderActor = game.actors.get(orig.fromActorId);
      // The identity the quoted mail came FROM (an alias stays the alias).
      const origIds = { contactId: orig.fromContactId, actorId: orig.fromActorId, email: orig.from, storedName: orig.fromName };
      const senderName = resolveDisplayName(origIds, senderActor?.name || orig.from || 'Unknown');
      const senderEmail = orig.from
        || (senderActor ? (this.contactRepo?.getActorEmail(orig.fromActorId) || '') : '');
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
        hue: hueVar(senderName),
        portrait: resolveDisplayPortrait(origIds) || null,
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

    // ── Anonymous Send (GM only) ──
    const anonFeatureEnabled = isGM && this._isAnonFeatureEnabled();
    const anonActive = anonFeatureEnabled && this.anonymousEnabled;
    const anonStyleNorm = normalizeAnonStyle(this.anonStyle);
    let anonTraceEnabled = true;
    try { anonTraceEnabled = game.settings.get(MODULE_ID, 'anonTraceEnabled'); } catch { /* default on */ }
    const anonStyleList = Object.entries(ANON_STYLE_LABELS).map(([id, label]) => ({ id, label, active: id === anonStyleNorm }));

    // The picked identity's own face. An alias never borrows its character's
    // portrait (resolveDisplayPortrait) — it shows its own, else initials.
    const fromImgResolved = (this.fromContact?.id
      ? resolveDisplayPortrait({ contactId: this.fromContact.id, actorId: this.fromActorId })
      : (resolveDisplayPortrait({ actorId: this.fromActorId }) || fromActor?.img))
      || this.fromContact?.portrait || null;

    return {
      MODULE_ID,
      mode: this.mode,
      isReply: this.mode === 'reply',
      isForward: this.mode === 'forward',
      isGM,
      isGMSendAs,
      // The From switcher: GM Send-as, or a player's own addresses. Never while
      // sending as a terminal account.
      canSwitchFrom: (isGM || sendChoices.length > 1) && !this.terminalSend,
      fromIsAlias,
      terminalSend: this.terminalSend ? { ...this.terminalSend, impersonating: !this.terminalSend.own } : null,

      // Header
      fromName,
      fromEmail,
      fromImg: fromImgResolved,
      fromInitials,
      fromAvatarColor,

      // Anonymous Send
      anonFeatureEnabled,
      anonActive,
      anonymousEnabled: this.anonymousEnabled,
      anonStyle: anonStyleNorm,
      anonStyleList,
      anonStyleLabel: ANON_STYLE_LABELS[anonStyleNorm] || 'Scrambled',
      anonAlias: this.anonAlias,
      anonAliasDisplay: (this.anonAlias || '').trim() || 'UNKNOWN',
      anonMaskedEmail: ANON_MASKED_EMAIL,
      anonAllowReplies: this.anonAllowReplies,
      anonTraceFeatureEnabled: anonTraceEnabled,
      anonTraceDV: this.anonTraceDV,
      networkName,
      networkThemeColor,
      isDeadZone,
      netPillState,
      netPillBars,
      fxTags,
      netViaOverride: !!viaNetwork,
      netPicker: this._buildNetPicker(),

      // GM date chip (backdate)
      sendBackdated: isGM && !!this.sendTimestamp,
      sendTimestampFormatted: this.sendTimestamp ? formatCyberDate(this.sendTimestamp) : '',
      fromHue: hueVar(fromName),

      // Time
      currentGameTime: formatCyberDate(this.timeService?.getCurrentTime?.() || new Date().toISOString()),

      // Fields — every chip carries its name's hue
      recipients: this.recipients.map(r => ({ ...r, hue: hueVar(r.name || r.email || '?') })),
      recipientLocked: this.mode === 'reply' && this.recipients.length > 0,
      subject: this.subject,
      body: this.body,

      // Delivery chips + the one drawer
      drawer: this._drawer,
      priorities,
      priorityLabel: PRIORITY_LABELS[this.priority] || this.priority,
      priorityTone: PRIORITY_TONES[this.priority] || 'act',
      priorityOn: this.priority !== 'normal',

      // Encryption
      encryptionEnabled: this.encryptionEnabled,
      encryptionDV: this.encryptionDV,
      encryptionType: this.encryptionType,
      encryptionFailureMode: this.encryptionFailureMode,
      encryptionMaxAttempts: this.encryptionMaxAttempts,
      isLethalICE,
      encTypes,
      lockLabel,
      lockTone,
      iceSource: this.iceSource,
      iceActorId: this.iceActorId,
      iceActors: game.nightcity?.iceService?.getAvailableICEActors() ?? [],

      // Self-destruct
      selfDestructEnabled: this.selfDestructEnabled,
      selfDestructOptions,
      selfDestructLabel: SD_LABELS[this.selfDestructMode] || this.selfDestructMode,

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
      draftCount: this._draftCount(),
      templateCount: isGM ? (this.messageTemplateService?.count ?? 0) : 0,

      // GM: the form swapped for what the recipient will open
      preview: (isGM && this._preview) ? this._buildPreview({ fromName, fromEmail, fromImg: fromImgResolved, fromInitials, networkName: network?.name || networkName, anonStyleNorm }) : null,
    };
  }

  /** The preview view-model (previewModel.js) from the composer's live state. */
  _buildPreview({ fromName, fromEmail, fromImg, fromInitials, networkName, anonStyleNorm }) {
    const anon = game.user.isGM && this.anonymousEnabled && this._isAnonFeatureEnabled();
    return buildPreview({
      anon,
      anonStyle: anonStyleNorm,
      anonAlias: this.anonAlias,
      anonMaskedEmail: ANON_MASKED_EMAIL,
      anonAllowReplies: this.anonAllowReplies,
      fromName, fromEmail, fromImg, fromInitials,
      networkName,
      when: this.sendTimestamp ? formatCyberDate(this.sendTimestamp) : formatCyberDate(this.timeService?.getCurrentTime?.() || new Date().toISOString()),
      priority: this.priority,
      subject: this.subject,
      body: this.body,
      isReply: this.mode === 'reply',
      encryption: { enabled: this.encryptionEnabled, dv: this.encryptionDV, type: this.encryptionType, failureMode: this.encryptionFailureMode },
      selfDestruct: { enabled: this.selfDestructEnabled, mode: this.selfDestructMode },
      schedule: { enabled: this.scheduleEnabled, timeFormatted: this.scheduledTime ? formatCyberDate(this.scheduledTime) : '' },
      recipients: this.recipients,
      attachments: this.attachments,
    });
  }

  /** Header controls (mirrors BaseApplication): the GM-view toggle is the injected header BUTTON, not a ⋮ entry. Always a copy. */
  _getHeaderControls() {
    return [...(super._getHeaderControls?.() ?? [])];
  }

  /** Header-control actions without a DEFAULT_OPTIONS handler (mirrors BaseApplication). */
  _onClickAction(event, target) {
    if (target?.dataset?.action === 'toggleGmView') { toggleGmView(); return; }
    return super._onClickAction?.(event, target);
  }

  /** GM-view text size: zoom the content and grow the frame once by the ratio. */
  _applyGmZoom(pct) {
    const el = this.element;
    if (!el) return;
    const clamped = Math.min(150, Math.max(100, Number(pct) || 100));
    applyAdminZoom(el.querySelector('.window-content'), clamped);
    const prev = this._appliedTextScale ?? 100;
    if (clamped !== prev) {
      const ratio = clamped / prev;
      const { width, height } = this.position ?? {};
      const next = {};
      if (typeof width === 'number' && width > 0) next.width = Math.round(width * ratio);
      if (typeof height === 'number' && height > 0) next.height = Math.round(height * ratio);
      if (Object.keys(next).length) { try { this.setPosition(next); } catch { /* non-fatal */ } }
      this._appliedTextScale = clamped;
    }
  }

  _onRender(context, options) {
    // GM view (admin theme) — stamped before any DOM wiring so the first
    // paint is already themed; player view clears it and shrinks back.
    if (!applyGmView(this.element, { applyZoom: (pct) => this._applyGmZoom(pct) })) this._applyGmZoom(100);
    this._setupRecipientAutocomplete();
    this._setupEditorSync();
    this._setupFormSync();
    this._setupKeyboardShortcuts();
    this._startAutoSave();
    this._setupSendAsList();
    this._setupNetPicker();
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

  async close(options = {}) {
    this._stopAutoSave();
    this._closeNetPicker();
    this._closeTemplatesMenu();
    // A window with something in it leaves a draft behind (nothing is lost to
    // Esc); an empty one takes its draft with it. A sent / saved-on-purpose
    // message is already settled (_draftDone).
    if (!this._draftDone && !options.noDraft) {
      try {
        this._syncFormData();
        if (draftHasContent(this._draftRecord())) this._performAutoSave({ silent: true });
        else if (this._draftId) await this._deleteDraft(this._draftId);
      } catch { /* never block closing */ }
    }
    this._netChangedHandle?.unsubscribe?.();
    this._netChangedHandle = null;
    if (this._editorStateHandler) {
      document.removeEventListener('selectionchange', this._editorStateHandler);
      this._editorStateHandler = null;
    }
    return super.close(options);
  }

  // ─── Network Picker (header pill dropdown) ────────────────

  /**
   * Rows for the header network pill's dropdown. Two behaviours:
   *  - PLAYER: the inbox selector's list (only reachable networks; locked ones
   *    go through the auth dialog). Picking one is a real connection switch.
   *  - GM: every network, for THIS MESSAGE only. Their own connection is
   *    pinned first as the default; search + type chips narrow a long list.
   */
  _buildNetPicker() {
    const ns = this.networkService;
    const isGM = game.user.isGM;
    const empty = { isGM, rows: [], filters: [], hasRows: false, isDeadZone: false, footer: '' };
    if (!ns) return empty;

    const TYPE_LABELS = {
      public: 'Public Subnet', hidden: 'Hidden Subnet', corporate: 'Corporate Subnet',
      government: 'Government Subnet', custom: 'Custom Subnet',
    };
    const CHIP_LABELS = { public: 'Public', hidden: 'Hidden', corporate: 'Corp', government: 'Gov', custom: 'Custom' };
    const currentId = ns.currentNetworkId;
    const availableIds = new Set((ns.getAvailableNetworks?.() ?? []).map(n => n.id));
    const base = (net) => {
      const kind = TYPE_LABELS[net.type] ? net.type : 'custom';
      return {
        id: net.id,
        name: net.name,
        kind,
        typeLabel: TYPE_LABELS[kind],
        theme: net.theme || {},
        color: net.theme?.color ?? '#19f3f7',
        signalStrength: net.signalStrength ?? 75,
        inRange: availableIds.has(net.id) && (net.signalStrength ?? 75) > 0,
      };
    };
    const all = ns.getAllNetworks?.() ?? [];

    if (!isGM) {
      // Same reachability rules as MessageViewerApp._buildSelectorNetworks.
      if (ns.isDeadZone) return { ...empty, isDeadZone: true, footer: 'Dead zone — all signals jammed' };
      const order = { active: 0, available: 1, locked: 2 };
      const rows = all.map(base).filter(r => r.inRange).map(r => {
        const net = ns.getNetwork(r.id);
        const locked = (net?.security?.requiresAuth ?? false) && !(ns.isAuthenticated?.(r.id) ?? false);
        const state = r.id === currentId ? 'active' : locked ? 'locked' : 'available';
        return {
          ...r, state,
          chip: state === 'active' ? 'Connected' : state === 'locked' ? 'Locked' : 'Connect',
          chipClass: state === 'active' ? 'on' : state === 'locked' ? 'locked' : 'go',
          meta: `${r.typeLabel} · ${r.signalStrength}%`,
        };
      }).sort((a, b) => order[a.state] - order[b.state]);
      return {
        ...empty, rows, hasRows: rows.length > 0,
        header: 'Available Networks',
        footer: 'Switches your connection — your inbox follows',
      };
    }

    // GM — the whole world's list; own connection pinned, then in-range, then A→Z.
    const mine = ns.getNetwork?.(currentId);
    const rows = all.map(base).map(r => {
      const isMine = r.id === currentId;
      const chosen = this.sendNetworkId ? this.sendNetworkId === r.id : isMine;
      return {
        ...r, pinned: isMine,
        state: chosen ? 'active' : 'available',
        chip: chosen ? (isMine ? 'Default' : 'Sending via') : (isMine ? 'Use default' : 'Send via'),
        chipClass: chosen ? (isMine ? 'on' : 'via') : 'go',
        meta: isMine
          ? `Your connection · ${r.signalStrength}%`
          : `${r.typeLabel} · ${r.signalStrength}%${r.inRange ? '' : ' · out of range'}`,
        oor: !r.inRange,
        search: `${r.name} ${r.typeLabel}`.toLowerCase(),
      };
    }).sort((a, b) => (b.pinned - a.pinned) || (b.inRange - a.inRange) || a.name.localeCompare(b.name));

    const others = rows.filter(r => !r.pinned);
    const filters = [
      { key: 'all', label: 'All', count: others.length, active: true },
      { key: 'range', label: 'In range', count: others.filter(r => r.inRange).length },
      ...Object.keys(CHIP_LABELS)
        .map(k => ({ key: k, label: CHIP_LABELS[k], count: others.filter(r => r.kind === k).length }))
        .filter(f => f.count > 0),
    ];
    return {
      ...empty, rows, hasRows: rows.length > 0,
      header: 'Send this message via',
      filters,
      showFilters: others.length > 0,
      footer: `This message only — you stay on ${mine?.name || 'your connection'}`,
    };
  }

  /** Wire the network dropdown: picks, search, filter chips, outside-click close. */
  _setupNetPicker() {
    const el = this.element;
    const menu = el?.querySelector('[data-id="net-picker"]');
    if (!menu || menu._ncmBound) return;
    menu._ncmBound = true;

    let filter = 'all';
    const search = menu.querySelector('[data-id="net-search"]');
    const apply = () => {
      const q = (search?.value || '').trim().toLowerCase();
      let shown = 0;
      menu.querySelectorAll('[data-net-pick]').forEach(row => {
        if (row.dataset.pinned) return;
        const okF = filter === 'all' || (filter === 'range' ? row.dataset.range === '1' : row.dataset.kind === filter);
        const ok = okF && (!q || (row.dataset.search || '').includes(q));
        row.classList.toggle('ncm-hidden', !ok);
        if (ok) shown++;
      });
      menu.querySelector('[data-id="net-empty"]')?.classList.toggle('ncm-hidden', shown > 0);
    };
    search?.addEventListener('input', apply);

    menu.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-net-filter]');
      if (chip) {
        e.preventDefault();
        filter = chip.dataset.netFilter;
        menu.querySelectorAll('[data-net-filter]').forEach(c =>
          c.classList.toggle('ncm-composer__net-fchip--on', c === chip));
        apply();
        return;
      }
      const row = e.target.closest('[data-net-pick]');
      if (row) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._onPickNetwork(row.dataset.netPick);
      }
    }, true);
  }

  _closeNetPicker() {
    const menu = this.element?.querySelector('[data-id="net-picker"]');
    menu?.classList.add('ncm-hidden');
    this.element?.querySelector('[data-action="toggleNetPicker"]')?.classList.remove('ncm-composer__net-pill--open');
    if (this._netOutsideHandler) {
      document.removeEventListener('click', this._netOutsideHandler, true);
      this._netOutsideHandler = null;
    }
  }

  static _onToggleNetPicker(event, target) {
    const menu = this.element?.querySelector('[data-id="net-picker"]');
    if (!menu) return;
    if (!menu.classList.contains('ncm-hidden')) { this._closeNetPicker(); return; }

    menu.classList.remove('ncm-hidden');
    target.classList.add('ncm-composer__net-pill--open');
    // Anchor under the pill (the header is the positioning context) — pulled
    // left when the dropdown would run past the window's right edge.
    const hostW = target.offsetParent?.clientWidth || 0;
    const left = hostW ? Math.max(8, Math.min(target.offsetLeft, hostW - menu.offsetWidth - 12)) : target.offsetLeft;
    menu.style.left = `${left}px`;
    menu.querySelector('[data-id="net-search"]')?.focus();

    this._netOutsideHandler = (e) => {
      if (menu.contains(e.target) || target.contains(e.target)) return;
      this._closeNetPicker();
    };
    requestAnimationFrame(() => document.addEventListener('click', this._netOutsideHandler, true));
  }

  /**
   * GM: set (or clear) this message's network. Player: switch the real
   * connection — same auth gate as the inbox selector — and let the
   * NETWORK_CHANGED listener re-render.
   */
  async _onPickNetwork(networkId) {
    this._closeNetPicker();
    if (!networkId) return;
    const ns = this.networkService;

    if (game.user.isGM) {
      this.sendNetworkId = networkId === ns?.currentNetworkId ? null : networkId;
      this.render();
      return;
    }

    const network = ns?.getNetwork?.(networkId);
    if (!network || networkId === ns.currentNetworkId) return;
    const requiresAuth = network.security?.requiresAuth ?? false;
    if (requiresAuth && !(ns.isAuthenticated?.(networkId) ?? false)) {
      const { NetworkAuthDialog } = await import('../NetworkManagement/NetworkAuthDialog.js');
      const result = await NetworkAuthDialog.show(networkId);
      if (!result?.success) return;
    }
    const res = await ns.switchNetwork?.(networkId);
    if (res?.success === false) {
      ui.notifications.warn(`NCM | Could not switch to ${network.name}: ${res.reason || 'unknown error'}`);
    }
  }

  // ─── GM Date Chip (backdate) ──────────────────────────────

  /**
   * GM: pick this message's date. Past → delivered now but stamped then.
   * Future → that's a schedule, so it switches on the existing Schedule
   * instead of inventing a second one. Clear → now.
   */
  static _onPickSendDate(event, target) {
    if (!game.user.isGM) return;
    const nowMs = this.timeService?.getCurrentTimeMs?.() ?? Date.now();
    CyberTimePicker.open({
      value: this.sendTimestamp || this.timeService?.getCurrentTime?.() || new Date().toISOString(),
      title: 'Message Date',
      onSet: (iso) => {
        const ms = new Date(iso).getTime();
        if (!Number.isFinite(ms)) return;
        if (ms > nowMs) {
          this.sendTimestamp = '';
          this.scheduleEnabled = true;
          this.scheduledTime = iso;
          this.scheduleGameTime = true;
          ui.notifications.info('NCM | That date is in the future — the message will be scheduled for it.');
        } else {
          this.sendTimestamp = new Date(ms).toISOString();
        }
        this.render();
      },
      onClear: () => {
        this.sendTimestamp = '';
        this.render();
      },
    });
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
    if (this.encryptionEnabled) {
      const isLethal = this.encryptionType === 'BLACK_ICE' || this.encryptionType === 'RED_ICE';
      const typeLabel = this.encryptionType.replace('_', ' ');
      tags.push({
        label: `${typeLabel} DV ${this.encryptionDV}`,
        icon: isLethal ? 'fa-skull-crossbones' : 'fa-shield-halved',
        variant: isLethal ? 'danger' : 'encrypted',
      });
    } else {
      tags.push({ label: 'Cleartext', icon: 'fa-unlock', variant: 'open' });
    }

    // Self-destruct
    if (this.selfDestructEnabled)
      tags.push({ label: 'Self-Destruct', icon: 'fa-bomb', variant: 'destruct' });

    return tags;
  }

  // ─── Recipient Management ─────────────────────────────────

  /**
   * @param {string} actorId
   * @param {boolean} [locked]
   * @param {{contactId: string, email?: string, name?: string}|null} [ident] the exact
   *   identity picked (a directory contact linked to this character — utils/identities.js).
   *   Without it the chip collapsed to the character's main address, so mail
   *   sent to an alias was stored as sent to the main one.
   */
  _addRecipient(actorId, locked = false, ident = null) {
    if (!actorId || this.recipients.find(r => r.actorId === actorId)) return;

    const actor = game.actors.get(actorId);
    let name, email;
    let contactId = null;

    if (actor) {
      email = this.contactRepo?.getActorEmail(actorId) || '';
      // Directory name beats the actor label (the GM edits the directory).
      name = resolveDisplayName({ actorId, email }, actor.name);
    } else {
      // Actor not visible to this client — fall back to master contact data
      const masterService = game.nightcity?.masterContactService;
      const mc = masterService?.getAll?.()?.find(c => c.actorId === actorId);
      if (mc) {
        name = mc.name;
        email = mc.email || '';
        contactId = mc.id;
      } else {
        // Last resort — check if we have info from the original message
        return; // Truly unknown, skip
      }
    }

    if (ident?.contactId) {
      contactId = ident.contactId;
      if (ident.email) email = ident.email;
      if (ident.name) name = ident.name;
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
      contactId,
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

  /**
   * Add a contact-only recipient — one of the player's contacts (or a master
   * directory entry) that has NO linked actor. Addressed by email, carrying the
   * master id when known. Before this, the To search only surfaced contacts
   * with an actor link, so a shared NPC contact without an actor could only be
   * reached by typing its address as a "raw" recipient.
   * @param {{contactId?: string|null, name: string, email: string}} r
   */
  _addContactRecipient(r) {
    const email = (r?.email || '').trim();
    if (!email) return;
    if (this.recipients.find(x => x.email === email)) return;
    const name = r.name || email;
    this.recipients.push({
      actorId: null,
      contactId: r.contactId || null,
      name,
      email,
      avatarColor: getAvatarColor(name),
      initials: getInitials(name),
      mismatch: false,
      mismatchTooltip: '',
      unreachable: false,
      locked: false,
      isRaw: false,
    });
    if (this._errors.to) delete this._errors.to;
  }

  /** The identity a recipient chip is removed by: actor id → master id → email. */
  static recipientKey(r) {
    return r?.groupId || r?.actorId || r?.contactId || r?.email || '';
  }

  _removeRecipient(key) {
    if (!key) return;
    this.recipients = this.recipients.filter(r => MessageComposerApp.recipientKey(r) !== key);
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
          this._removeRecipient(MessageComposerApp.recipientKey(last));
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

    const q = query.toLowerCase();
    if (this.terminalSend) {
      // The account's own address book — who it has written to / heard from.
      const have = new Set(this.recipients.map(r => (r.email || '').toLowerCase()));
      this._searchResults = this.addressBook
        .filter(e => !have.has((e.email || '').toLowerCase()) && (e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q)))
        .slice(0, 8)
        .map(e => ({ actorId: e.actorId || null, contactId: e.contactId || null, name: e.name, email: e.email, img: null, initials: getInitials(e.name), avatarColor: getAvatarColor(e.name) }));
      this._selectedResultIndex = this._searchResults.length ? 0 : -1;
      this._renderAutocomplete(query);
      return;
    }
    const directory = this.contactRepo?.getGlobalActorDirectory() || [];
    const existingIds = new Set(this.recipients.map(r => r.actorId).filter(Boolean));
    const existingEmails = new Set(this.recipients.map(r => (r.email || '').toLowerCase()).filter(Boolean));
    const reachableIds = this.networkService?.getReachableNetworkIds() || [];

    // Contact groups first — one chip, N people (the character's own groups,
    // plus the GM's when the GM is composing).
    const existingGroups = new Set(this.recipients.map(r => r.groupId).filter(Boolean));
    const groupHits = (this.contactGroupService?.searchGroups?.(query, { actorId: this.fromActorId, isGM: game.user.isGM }) || [])
      .filter(g => !existingGroups.has(g.id))
      .slice(0, 4)
      .map(g => MessageComposerApp._groupResult(g));

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
        if (isHiddenCharacter(mc.actorId)) continue;
        if (mc.actorId) {
          const mcEmail = (mc.email || '').toLowerCase();
          if (!existingIds.has(mc.actorId) && !results.find(r => r.contactId === mc.id || (mcEmail && (r.email || '').toLowerCase() === mcEmail))) {
            results.push({
              actorId: mc.actorId,
              contactId: mc.id || null,
              name: mc.name,
              email: mc.email,
              img: mc.portrait || null,
            });
          }
        } else if (mc.email) {
          // A directory contact with no linked actor (an NPC that exists only
          // in the Master List) is a real, two-way address — it used to be
          // skipped here, so the GM was offered only "send as raw address".
          const emailLc = mc.email.toLowerCase();
          if (existingEmails.has(emailLc)) continue;
          if (results.find(r => (r.email || '').toLowerCase() === emailLc)) continue;
          results.push({ actorId: null, contactId: mc.id || null, name: mc.name, email: mc.email, img: mc.portrait || null });
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
          const cEmail = (contact.email || '').toLowerCase();
          if (!existingIds.has(contact.actorId) && !results.find(r => (contact.masterContactId && r.contactId === contact.masterContactId) || (cEmail && (r.email || '').toLowerCase() === cEmail))) {
            results.push({
              actorId: contact.actorId,
              contactId: contact.masterContactId || null,
              name: contact.name,
              email: contact.email,
              img: contact.customImg || null,
            });
          }
        } else if (contact.email) {
          // Contact-only entry (no linked actor) — addressable by email.
          const emailLc = contact.email.toLowerCase();
          if (existingEmails.has(emailLc)) continue;
          if (results.find(r => (r.email || '').toLowerCase() === emailLc)) continue;
          results.push({
            actorId: null,
            contactId: contact.masterContactId || null,
            name: contact.name,
            email: contact.email,
            img: contact.customImg || null,
          });
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

    // Send-only system addresses never appear in a player's recipient search
    // (the service also hard-blocks the send — this just keeps the UI honest).
    if (!game.user.isGM) {
      const mcs = game.nightcity?.masterContactService;
      results = results.filter(r => !r.email || !mcs?.isSendOnly?.(r.email));
    }

    this._searchResults = [...groupHits, ...results];
    this._selectedResultIndex = this._searchResults.length > 0 ? 0 : -1;
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

    const items = this._searchResults.map((r, i) => r.isGroup ? `
      <div class="ncm-autocomplete-item ncm-autocomplete-item--group ${i === this._selectedResultIndex ? 'ncm-autocomplete-item--selected' : ''}"
           data-index="${i}" data-group-id="${r.groupId}" style="--tc:${hueVar(r.name)}">
        <div class="ncm-autocomplete__avatar">${r.img ? `<img src="${String(r.img).replace(/"/g, '&quot;')}" alt="">` : '<i class="fas fa-users"></i>'}</div>
        <div class="ncm-autocomplete__info">
          <div class="ncm-autocomplete__name">${r.name}</div>
          <div class="ncm-autocomplete__email">${r.memberCount} ${r.memberCount === 1 ? 'member' : 'members'} · ${r.memberNames}</div>
        </div>
      </div>
    ` : `
      <div class="ncm-autocomplete-item ${i === this._selectedResultIndex ? 'ncm-autocomplete-item--selected' : ''} ${r.greyed ? 'ncm-autocomplete-item--greyed' : ''}"
           data-index="${i}" data-actor-id="${r.actorId || ''}" style="--tc:${hueVar(r.name)}">
        <div class="ncm-autocomplete__avatar">${r.initials}</div>
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

    if (result.isGroup) this._addGroupRecipient(result);
    else if (result.actorId) this._addRecipient(result.actorId, false, result.contactId ? { contactId: result.contactId, email: result.email, name: result.name } : null);
    else this._addContactRecipient(result);
    this._closeAutocomplete();
    this.render(true);
  }

  /** The autocomplete/chip view of a contact group. */
  static _groupResult(g) {
    const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return {
      isGroup: true, groupId: g.id, scope: g.scope || 'actor',
      name: esc(g.name), email: '', actorId: null, contactId: null,
      initials: '', avatarColor: g.color || '#19f3f7', img: g.img || '',
      memberCount: (g.members || []).length,
      memberNames: esc((g.members || []).map(m => m.name || m.email).filter(Boolean).join(', ')),
    };
  }

  /**
   * One chip for a whole group. Members are resolved NOW (address → live actor /
   * directory entry) so the send list is concrete; anyone unresolvable is named
   * once, up front, instead of failing at send.
   */
  _addGroupRecipient(result) {
    if (!result?.groupId || this.recipients.some(r => r.groupId === result.groupId)) return;
    const svc = this.contactGroupService;
    const group = svc?.findGroup?.(result.groupId, { actorId: this.fromActorId, isGM: game.user.isGM });
    if (!group) return;
    const { recipients, unresolved } = svc.recipientsFor(group);
    if (!recipients.length) {
      ui.notifications.warn(`NCM | "${group.name}" has no one reachable in it.`);
      return;
    }
    if (unresolved.length) ui.notifications.warn(`NCM | "${group.name}": ${unresolved.join(', ')} could not be found and will be skipped.`);
    this.recipients.push({
      isGroup: true, groupId: group.id, name: group.name, email: '', actorId: null, contactId: null,
      initials: '', avatarColor: group.color || '#19f3f7', img: group.img || '',
      members: recipients, memberCount: recipients.length,
      memberNames: recipients.map(r => r.name || r.email).join(', '),
      locked: false, mismatch: false, unreachable: false, isRaw: false,
    });
  }

  /** Re-add a group chip by id (draft restore, launcher option). */
  _addGroupById(groupId) {
    const g = this.contactGroupService?.findGroup?.(groupId, { actorId: this.fromActorId, isGM: game.user.isGM });
    if (g) this._addGroupRecipient(MessageComposerApp._groupResult(g));
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

    // Paste hygiene (2026-10-23): the browser's default paste carries the source's
    // computed styles inline (a journal page = near-black text on parchment, so it
    // lands as black text and white blocks on a dark theme). Clean it to structure +
    // inline formatting with every colour dropped; plain text (a PDF) is reflowed
    // from hard-wrapped lines back into paragraphs.
    editor.addEventListener('paste', (ev) => {
      const cd = ev.clipboardData;
      if (!cd) return;
      const html = cd.getData('text/html') || '';
      const text = cd.getData('text/plain') || '';
      if (!html && !text) return;
      ev.preventDefault();
      const out = pasteToHtml({ html, text }, { mode: 'mail' });
      if (!out) return;
      try { document.execCommand('insertHTML', false, out); } catch { editor.insertAdjacentHTML('beforeend', out); }
      editor.dispatchEvent(new Event('input', { bubbles: true }));
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

    // Also guard the overflow + templates menu items
    for (const id of ['overflow-menu', 'tpl-menu']) {
      const menu = this.element?.querySelector(`[data-id="${id}"]`);
      menu?.addEventListener('mousedown', (e) => {
        if (e.target.closest('.ncm-composer__overflow-item')) e.preventDefault();
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

  /**
   * Autosave = write THIS window's draft (minted on the first save) into the
   * character's `composerDrafts` list. Nothing is written for an empty window,
   * so opening and closing a composer never leaves a draft behind.
   * @param {{ silent?: boolean }} [o] silent = no indicator repaint (close path)
   */
  _performAutoSave({ silent = false } = {}) {
    this._syncFormData();
    const record = this._draftRecord();
    if (!draftHasContent(record)) return false;

    const actor = game.actors.get(this.fromActorId);
    if (!actor || !(actor.isOwner || game.user.isGM)) return false;

    if (!this._draftId) this._draftId = newDraftId();
    record.id = this._draftId;
    const now = new Date();
    record.savedAt = now.toISOString();
    this.autoSaveTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (!silent) {
      const indicator = this.element?.querySelector('.ncm-composer__autosave');
      if (indicator) {
        indicator.innerHTML = `<i class="fas fa-circle-check"></i> Saved ${this.autoSaveTime}`;
        indicator.classList.remove('ncm-hidden');
      }
    }

    // One key merged in; the oldest past the cap go out as deletion keys.
    const { map } = readDrafts(actor, MODULE_ID);
    map[record.id] = record;
    const { dropped } = pruneDrafts(map);
    const patch = { [record.id]: record };
    for (const id of dropped) if (id !== record.id) patch[`-=${id}`] = null;
    actor.setFlag(MODULE_ID, DRAFTS_FLAG, patch).catch(() => {});
    return true;
  }

  /** Everything a draft needs to come back as it was — including its quote card. */
  _draftRecord() {
    return {
      id: this._draftId,
      mode: this.mode,
      originalMessageId: this.originalMessage?.messageId || null,
      originalActorId: this.originalMessage ? (this.fromActorId || null) : null,
      threadId: this.threadId,
      inReplyTo: this.inReplyTo,
      fromActorId: this.fromActorId,
      fromContactId: this.fromContact?.id || null,
      recipients: this.recipients.filter(r => !r.isAnonTarget).map(r => ({
        actorId: r.actorId || null, contactId: r.contactId || null, email: r.email || '', name: r.name || '',
        isRaw: !!r.isRaw, groupId: r.groupId || null,
      })),
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
      scheduleEnabled: this.scheduleEnabled,
      scheduledTime: this.scheduledTime,
      scheduleGameTime: this.scheduleGameTime,
      anonymousEnabled: this.anonymousEnabled,
      anonStyle: this.anonStyle,
      anonAlias: this.anonAlias,
      anonAllowReplies: this.anonAllowReplies,
      anonTraceDV: this.anonTraceDV,
      sendNetworkId: this.sendNetworkId,
      sendTimestamp: this.sendTimestamp,
      savedAt: null,
    };
  }

  /** The character's drafts (newest first), lifting a legacy single draft once. */
  _drafts() {
    const actor = game.actors.get(this.fromActorId);
    return actor ? readDrafts(actor, MODULE_ID).list : [];
  }

  _draftCount() { return this._drafts().length; }

  /**
   * Put a draft back into this window. Resets the composer first, then
   * rebuilds a reply/forward from its original (through the repository; if the
   * original is gone it opens as a plain message and says so).
   */
  async _applyDraft(draft) {
    if (!draft) return false;
    this._resetForDraft();
    this._draftId = draft.id;
    this.mode = 'compose';
    this.originalMessage = null;

    if ((draft.mode === 'reply' || draft.mode === 'forward') && draft.originalMessageId) {
      const inboxActorId = draft.originalActorId || this.fromActorId;
      const orig = inboxActorId ? await this.messageService?.getMessage?.(inboxActorId, draft.originalMessageId).catch(() => null) : null;
      if (orig) {
        this.mode = draft.mode;
        this.originalMessage = orig;
        if (draft.mode === 'reply') this._initReply({});
        else this._initForward();
      } else {
        ui.notifications.warn('NCM | The message this draft answered is gone — opening it as a new message.');
      }
    }

    // The draft's own fields win over what the reply/forward setup seeded.
    const have = new Set(this.recipients.map(r => MessageComposerApp.recipientKey(r)));
    for (const r of (draft.recipients || [])) {
      if (r.groupId) { if (!have.has(r.groupId)) this._addGroupById(r.groupId); continue; }
      if (r.actorId && !have.has(r.actorId)) this._addRecipient(r.actorId, false, r.contactId ? { contactId: r.contactId, email: r.email, name: r.name } : null);
      else if (!r.actorId && (r.contactId || r.email) && !have.has(r.contactId || r.email)) {
        if (r.isRaw || !r.name) this._addRawRecipient(r.email);
        else this._addContactRecipient({ contactId: r.contactId, email: r.email, name: r.name });
      }
    }
    this.subject = draft.subject || this.subject || '';
    this.body = draft.body || '';
    this.threadId = draft.threadId ?? this.threadId;
    this.inReplyTo = draft.inReplyTo ?? this.inReplyTo;
    this.priority = draft.priority || 'normal';
    this.encryptionEnabled = !!draft.encryptionEnabled;
    this.encryptionDV = draft.encryptionDV || 12;
    this.encryptionType = draft.encryptionType || 'ICE';
    this.encryptionFailureMode = draft.encryptionFailureMode || 'nothing';
    this.encryptionMaxAttempts = draft.encryptionMaxAttempts || 0;
    this.iceSource = draft.iceSource || 'default';
    this.iceActorId = draft.iceActorId || null;
    this.encryptionBypassSkills = draft.encryptionBypassSkills || null;
    this.selfDestructEnabled = !!draft.selfDestructEnabled;
    this.selfDestructMode = draft.selfDestructMode || 'after_read';
    this.scheduleEnabled = !!draft.scheduleEnabled;
    this.scheduledTime = draft.scheduledTime || '';
    this.scheduleGameTime = !!draft.scheduleGameTime;
    if (game.user.isGM) {
      this.anonymousEnabled = !!draft.anonymousEnabled;
      if (draft.anonStyle) this.anonStyle = draft.anonStyle;
      this.anonAlias = draft.anonAlias || '';
      if (typeof draft.anonAllowReplies === 'boolean') this.anonAllowReplies = draft.anonAllowReplies;
      if (draft.anonTraceDV) this.anonTraceDV = draft.anonTraceDV;
      this.sendNetworkId = draft.sendNetworkId || null;
      this.sendTimestamp = draft.sendTimestamp || '';
    }
    if (!game.user.isGM && !this.terminalSend) {
      // A player's draft goes out from the address it was written from, if it still exists.
      const row = this._senderChoices().find(c => !c.isMain && c.id === draft.fromContactId);
      this.fromContact = row ? { id: row.id, name: row.name, email: row.email, portrait: row.portrait } : null;
    } else if (draft.fromContactId && !this.fromContact) {
      const mc = game.nightcity?.masterContactService?.getContact?.(draft.fromContactId);
      if (mc) this.fromContact = { id: mc.id, name: mc.name, email: mc.email, portrait: mc.portrait };
    }
    this.autoSaveTime = draft.savedAt ? new Date(draft.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
    this._errors = {};
    return true;
  }

  /** Back to an empty window (keeps the sender, the terminal lock and the window). */
  _resetForDraft() {
    this.recipients = [];
    this.subject = '';
    this.body = '';
    this.threadId = null;
    this.inReplyTo = null;
    this.anonReplyTo = null;
    this.attachments = [];
    this.eddiesAmount = 0;
    this._drawer = null;
    this._preview = false;
    this.ccFieldVisible = false;
  }

  /** composeMessage({ draftId }) → the draft lands before the first paint. */
  async _loadPendingDraft() {
    const id = this._pendingDraftId;
    if (!id) return;
    this._pendingDraftId = null;
    const draft = this._drafts().find(d => d.id === id);
    if (!draft) { ui.notifications.warn('NCM | That draft is gone.'); return; }
    await this._applyDraft(draft);
  }

  /** The footer link: pick one of this character's drafts and open it HERE.
   *  What is in the window now is saved first as its own draft (if it has
   *  content), so nothing is lost and nothing has to be asked. */
  async _openDraftInPlace() {
    const list = this._drafts();
    if (!list.length) return ui.notifications.info('No drafts for this character.');
    const now = Date.now();
    const entries = list.map(d => ({
      id: d.id,
      name: draftRecipientName(d, (aid) => game.actors.get(aid)?.name) || '(no recipient)',
      sub: draftLabel(d),
      note: relativeAge(Date.parse(d.savedAt || ''), now),
      tag: draftKind(d) ? (draftKind(d) === 'reply' ? 'Reply' : 'Forward') : '',
      img: 'icons/svg/book.svg',
    }));
    const pick = await showNamePicker({
      title: 'Your drafts', hint: 'Opens in this window. What you were writing is kept as its own draft.',
      entries, chips: false, admin: false, placeholder: 'search drafts…', closeLabel: 'Cancel',
      taken: this._draftId ? [this._draftId] : [], takenLabel: 'open now',
    });
    if (!pick?.id || pick.id === this._draftId) return;
    this._syncFormData();
    if (draftHasContent(this._draftRecord())) this._performAutoSave({ silent: true });
    const draft = this._drafts().find(d => d.id === pick.id);
    if (!draft) return ui.notifications.warn('NCM | That draft is gone.');
    await this._applyDraft(draft);
    this.render(true);
  }

  /** Delete one draft by id (a `-=id` deletion key on the flag). */
  async _deleteDraft(id) {
    const actor = game.actors.get(this.fromActorId);
    if (!actor || !id || !(actor.isOwner || game.user.isGM)) return;
    const map = actor.getFlag(MODULE_ID, DRAFTS_FLAG) || {};
    if (!(id in map)) return;
    await actor.setFlag(MODULE_ID, DRAFTS_FLAG, { [`-=${id}`]: null }).catch(() => {});
  }

  /** After a successful send: only THIS window's draft goes. */
  async _clearDraft() {
    this._draftDone = true;
    if (this._draftId) await this._deleteDraft(this._draftId);
    this._draftId = null;
  }


  // ─── GM Send-As (WP-4.5.6) ───────────────────────────────

  /** The addresses a player can send from (empty for a GM, or a terminal account). */
  _senderChoices() {
    if (game.user.isGM || this.terminalSend || !this.fromActorId) return [];
    return game.nightcity?.masterContactService?.senderChoicesFor?.(game.actors.get(this.fromActorId)) || [];
  }

  /** Start on the address the player picked in the Identity drawer. */
  _applyDefaultSender() {
    if (this.fromContact) return;
    const choices = this._senderChoices();
    const pick = pickSenderChoice(choices, game.actors.get(this.fromActorId)?.getFlag?.(MODULE_ID, SEND_AS_FLAG));
    if (pick && !pick.isMain) this.fromContact = { id: pick.id, name: pick.name, email: pick.email, portrait: pick.portrait };
  }

  /** A player on their main address, once they have aliases: that row's name, never an alias's. */
  _mainSenderName() {
    if (this.fromContact) return null;
    const choices = this._senderChoices();
    return choices.length > 1 ? choices[0].name : null;
  }

  _renderSendAsList(filter = '') {
    const list = this.element?.querySelector('[data-id="sendas-list"]');
    if (!list) return;

    if (!game.user.isGM) {
      const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
      list.innerHTML = this._senderChoices().map(c => {
        const on = this.fromContact?.id ? c.id === this.fromContact.id : c.isMain;
        return `
        <div class="ncm-sendas-item ${on ? 'ncm-sendas-item--active' : ''}" style="--tc:${hueVar(c.name)}"
             data-ncm-sendas-pick="${this.fromActorId}" data-ncm-contact-id="${c.isMain ? '' : esc(c.id)}">
          <div class="ncm-sendas-item__avatar">${esc(getInitials(c.name))}</div>
          <div class="ncm-sendas-item__info">
            <div class="ncm-sendas-item__name">${esc(c.name)}</div>
            <div class="ncm-sendas-item__email">${esc(c.email)}</div>
          </div>
          <span class="ncm-sendas-item__type ${c.isMain ? '' : 'is-alias'}">${c.isMain ? 'main' : 'alias'}</span>
        </div>`;
      }).join('');
      return;
    }

    // Pull from GM Master Contact Directory (the authoritative NPC list)
    const masterService = game.nightcity?.masterContactService;
    const masterContacts = (masterService?.getAll?.() || []).filter(c => !isHiddenCharacter(c.actorId));

    // Also include any actors with emails not in master (fallback)
    const masterActorIds = new Set(masterContacts.filter(c => c.actorId).map(c => c.actorId));
    const extraActors = game.actors.filter(a => {
      if (masterActorIds.has(a.id) || !isSelectableCharacter(a)) return false;
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
        isAlias: !!masterService?.identityRoleOf?.(c)?.isAlias,
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
      // With an identity picked, only THAT row is lit (not every identity of the character).
      const isActive = this.fromContact?.id
        ? c.contactId === this.fromContact.id
        : !!(c.actorId && c.actorId === this.fromActorId);
      const initials = getInitials(c.name);
      const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
      return `
        <div class="ncm-sendas-item ${isActive ? 'ncm-sendas-item--active' : ''}" style="--tc:${hueVar(c.name)}"
             data-ncm-sendas-pick="${c.actorId}" data-ncm-contact-id="${c.contactId}">
          <div class="ncm-sendas-item__avatar">${esc(initials)}</div>
          <div class="ncm-sendas-item__info">
            <div class="ncm-sendas-item__name">${esc(c.name)}${c.org ? ` <span>· ${esc(c.org)}</span>` : ''}</div>
            <div class="ncm-sendas-item__email">${esc(c.email)}</div>
          </div>
          <span class="ncm-sendas-item__type ${c.isAlias ? 'is-alias' : ''}">${c.isAlias ? 'alias' : (c.isMaster ? 'main' : esc(c.type || 'npc'))}</span>
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
      this._errors.to = 'Pick at least one recipient.';
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
      // Raw addresses AND contact-only recipients with no master id — both are
      // reached purely by email.
      const rawRecipients = this.recipients.filter(r => !r.actorId && !r.contactId && r.email && !r.isAnonTarget);
      const toActorId = actorRecipients.length === 1
        ? actorRecipients[0].actorId
        : actorRecipients.length > 1 ? actorRecipients.map(r => r.actorId) : null;

      // A sole actor-linked recipient also carries its address: when the
      // player can't see that actor, the service resolves the recipient
      // through the master directory / this address instead of failing.
      const soleActorEmail = (this.recipients.length === 1 && actorRecipients.length === 1)
        ? (actorRecipients[0].email || undefined)
        : undefined;

      // Every chip, as a plain recipient entry. Two or more → the service fans
      // out (one copy each, one sent copy, shared thread, participants list).
      const sendList = [];
      let hasGroup = false;
      const seenKeys = new Set();
      const pushRecipient = (r) => {
        const key = r.actorId ? `a:${r.actorId}` : r.contactId ? `c:${r.contactId}` : `e:${(r.email || '').toLowerCase()}`;
        if (!r.actorId && !r.contactId && !r.email) return;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        sendList.push({ actorId: r.actorId || null, contactId: r.contactId || null, email: r.email || '', name: r.name || '' });
      };
      for (const r of this.recipients) {
        if (r.isAnonTarget) continue;
        if (r.isGroup) { hasGroup = true; for (const m of (r.members || [])) pushRecipient(m); }
        else pushRecipient(r);
      }
      // Attached eddies ride on EVERY copy, so the sender pays once per recipient.
      const eddiesTotal = this.eddiesAmount * Math.max(1, sendList.length);

      const messageData = {
        recipients: (sendList.length > 1 || hasGroup) ? sendList : undefined,
        toActorId: toActorId || null,
        toContactId: contactRecipients.length > 0 ? contactRecipients[0].contactId
          : ((this.recipients.length === 1 && actorRecipients.length === 1) ? (actorRecipients[0].contactId || undefined) : undefined),
        to: rawRecipients.length > 0 ? rawRecipients[0].email
          : (contactRecipients.length > 0 ? contactRecipients[0].email : soleActorEmail),
        fromActorId: this.fromActorId || null,
        fromContactId: this.fromContact?.id || null,
        from: this.fromContact?.email || undefined,
        fromName: this.fromContact?.name || this._mainSenderName() || undefined,
        subject: this.subject,
        body: this.body,
        priority: this.priority,
        threadId: this.threadId,
        inReplyTo: this.inReplyTo,
        attachments: this.attachments.filter(a => !a.isEddies),
        eddies: (this.terminalSend && !this.terminalSend.own) ? 0 : (this.eddiesAmount || 0),
      };
      // The GM verifies a terminal send before delivering it (handleMessageRelay).
      if (this.terminalSend) {
        messageData.terminalSend = { itemUuid: this.terminalSend.itemUuid, accountId: this.terminalSend.accountId };
        // Recorded on the sender's sent copy only (MessageRepository.createMessage):
        // the GM's Messages feed shows the machine and who was really typing.
        messageData.sentVia = {
          machine: this.terminalSend.machine || '', account: this.terminalSend.username || '',
          operatorId: this.terminalSend.operatorId || '', operatorName: this.terminalSend.operatorName || '',
          impersonated: !this.terminalSend.own,
        };
      }

      // GM per-message overrides — the service honors them only for a GM sender.
      if (game.user.isGM && this.sendNetworkId) {
        messageData.network = this.sendNetworkId;
        messageData.networkOverride = true;
      }
      if (game.user.isGM && this.sendTimestamp && !this.scheduleEnabled) {
        messageData.timestamp = this.sendTimestamp;
        messageData.backdated = true;
      }

      // Anonymous reply — carry the hidden-target descriptor; the GM resolves the
      // real recipient at delivery (no toActorId/to is set client-side).
      if (this.anonReplyTo) {
        messageData.anonReply = this.anonReplyTo;
      }

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
        const expiresAt = this._computeExpiry();
        const nowMs = game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now();
        messageData.selfDestruct = {
          mode: this.selfDestructMode,
          expiresAt,
          // Total window — drives the countdown bar baseline in the viewer.
          duration: expiresAt ? (new Date(expiresAt).getTime() - nowMs) : null,
        };
      }

      // Anonymous Send (GM only) — attach the masking block. MessageService
      // strips the real identity from the recipient-facing copy; the real sender
      // (fromActorId above) rides along only on the GM-owned sent copy.
      if (game.user.isGM && this.anonymousEnabled && this._isAnonFeatureEnabled()) {
        let traceEnabled = true;
        try { traceEnabled = game.settings.get(MODULE_ID, 'anonTraceEnabled'); } catch { /* default on */ }
        messageData.anonymous = {
          enabled: true,
          style: normalizeAnonStyle(this.anonStyle),
          alias: (this.anonAlias || '').trim() || ANON_DEFAULT_ALIAS,
          maskedEmail: ANON_MASKED_EMAIL,
          allowReplies: !!this.anonAllowReplies,
          traceable: !!traceEnabled,
          traceDV: Number(this.anonTraceDV) || 15,
          traced: false,
        };
      }

      let result;

      // Deduct eddies from sender BEFORE sending (skip for contact-only senders)
      if (this.eddiesAmount > 0 && this.fromActorId) {
        if (sendList.length > 1) {
          ui.notifications.info(`NCM | ${this.eddiesAmount.toLocaleString()} eb × ${sendList.length} recipients = ${eddiesTotal.toLocaleString()} eb.`);
        }
        const deducted = await this._deductEddies(this.fromActorId, eddiesTotal);
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
        // Play success state. A QUEUED result (GM offline / dead zone) is a
        // success for the composer — the message is safe in the queue — but it
        // must not read "Delivered", which is the lie that sent testers hunting
        // for a message that had not left yet.
        this.soundService?.play?.(result.queued ? 'click' : 'send');
        if (this.terminalSend && !this.terminalSend.own) this._logTerminalSend();
        await this._playSendAnimation('success', { queued: !!result.queued, reason: result.reason, count: sendList.length });
        // Recency for the Contact Manager's group rail: every one of MY groups this
        // went to is stamped as just used (silent, never blocks).
        for (const r of this.recipients) {
          if (r.isGroup && r.groupId && (r.scope || 'actor') === 'actor') this.contactGroupService?.touchActorGroup?.(this.fromActorId, r.groupId);
        }

        // Partial fan-out: some recipients were refused (not in the directory,
        // send-only, inbox gone). Say who and why, and give their share back.
        if (result.failed?.length) {
          const why = result.failed.map(x => `${x.name}: ${x.error || 'unknown error'}`).join(' · ');
          ui.notifications.warn(`NCM | Not delivered to ${result.failed.length} of ${sendList.length} — ${why}`, { permanent: true });
          if (this.eddiesAmount > 0 && this.fromActorId) {
            await this._creditEddies(this.fromActorId, this.eddiesAmount * result.failed.length).catch(() => {});
          }
        }

        // NOTE: Do NOT credit the recipient here. The eddies travel with the
        // message (eddies flag) and are credited once when the recipient claims
        // them in the Message Viewer (_claimEddies). Crediting here too caused a
        // double transfer / duplicate wealth-ledger entry on the recipient.

        // Clear draft
        await this._clearDraft();

        this.close();
      } else {
        // Send failed — show failure animation with retry options
        if (this.eddiesAmount > 0) {
          await this._creditEddies(this.fromActorId, eddiesTotal);
        }
        await this._playSendAnimation('failure', { error: result?.error || 'Unknown transmission error' });
        // Don't close — user can retry/queue/draft from the overlay
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Send failed:`, error);
      // Refund eddies on exception too
      if (this.eddiesAmount > 0) {
        await this._creditEddies(this.fromActorId, eddiesTotal).catch(() => {});
      }
      await this._playSendAnimation('failure', { error: error.message || 'Unexpected transmission error' });
    } finally {
      this._sending = false;
      // Re-enable the send button on EVERY exit path. Success closes the window so
      // this is harmless there; on failure/exception the button was disabled at the
      // top of _onSend (pointer-events:none) and was previously only restored on the
      // eddies-early-return path — so a single failed send left the button dead to
      // mouse clicks while Ctrl+Enter (which calls _onSend directly) still worked.
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.classList.remove('ncm-composer__btn--disabled');
      }
    }
  }

  static _onCancel(event, target) {
    this.close();
  }

  static _onQueueMessage(event, target) {
    // Queue for dead zone — same as send, messageService handles queuing
    MessageComposerApp._onSend.call(this, event, target);
  }

  /** Draft = save and CLOSE (autosave keeps writing the same id while open). */
  static async _onSaveDraft(event, target) {
    const saved = this._performAutoSave({ silent: true });
    if (!saved) { ui.notifications.info('Nothing to save yet.'); return; }
    this._draftDone = true;
    ui.notifications.info('Draft saved — it is on the Agent\'s Drafts tab.');
    this.close({ noDraft: true });
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

  /** The lock-type segment (data-type); without one it cycles, as it always did. */
  static _onCycleEncryptionType(event, target) {
    const types = ['ICE', 'BLACK_ICE', 'RED_ICE'];
    const picked = target?.dataset?.type;
    if (picked && types.includes(picked)) this.encryptionType = picked;
    else {
      const idx = types.indexOf(this.encryptionType);
      this.encryptionType = types[(idx + 1) % types.length];
    }

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

  /** Explicit `data-on="1|0"` from a drawer segment, else a toggle. */
  static _wantOn(target, current) {
    const v = target?.dataset?.on;
    return v === '1' ? true : v === '0' ? false : !current;
  }

  static _onToggleSelfDestruct(event, target) {
    this._syncFormData();
    this.selfDestructEnabled = MessageComposerApp._wantOn(target, this.selfDestructEnabled);
    if (this.selfDestructEnabled) this._drawer = 'sd';
    this.render(true);
  }

  /** Picking a mode is wanting it — it switches self-destruct on too. */
  static _onSetSelfDestructMode(event, target) {
    this._syncFormData();
    this.selfDestructMode = target.dataset.mode;
    this.selfDestructEnabled = true;
    this.render(true);
  }

  // ── Anonymous Send (GM only) ──

  static _onToggleAnonymous(event, target) {
    if (!game.user.isGM) return;
    // Persist any typed alias/DV before re-render so it survives the toggle.
    this._syncFormData();
    this.anonymousEnabled = MessageComposerApp._wantOn(target, this.anonymousEnabled);
    if (this.anonymousEnabled) this._drawer = 'anon';
    this.render(true);
  }

  static _onSetAnonStyle(event, target) {
    if (!game.user.isGM) return;
    this._syncFormData();
    this.anonStyle = target.dataset.style || 'scrambled';
    this.render(true);
  }

  static _onToggleAnonReplies(event, target) {
    if (!game.user.isGM) return;
    this._syncFormData();
    this.anonAllowReplies = MessageComposerApp._wantOn(target, this.anonAllowReplies);
    this.render(true);
  }

  /** Read the anonymous alias + trace-DV inputs from the DOM into state. */
  _syncAnonFields() {
    const el = this.element;
    if (!el) return;
    const alias = el.querySelector('[data-id="anon-alias"]');
    if (alias) this.anonAlias = alias.value;
    const dv = el.querySelector('[data-id="anon-trace-dv"]');
    if (dv) this.anonTraceDV = parseInt(dv.value) || this.anonTraceDV;
  }

  // ── Schedule (WP-4.5.6) ──

  static _onToggleSchedule(event, target) {
    this._syncFormData();
    this.scheduleEnabled = MessageComposerApp._wantOn(target, this.scheduleEnabled);
    if (this.scheduleEnabled) this._drawer = 'sched';
    // A scheduled message is stamped when it's delivered — drop any backdate.
    if (this.scheduleEnabled) this.sendTimestamp = '';
    // Pre-fill with current time when enabling
    if (this.scheduleEnabled && !this.scheduledTime) {
      this.scheduledTime = this.timeService?.getCurrentTime?.() || new Date().toISOString();
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
    if (!game.user.isGM && this._senderChoices().length < 2) return;
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
        // Actor-backed contact. When the row is a directory contact (an identity
        // of that character), keep it too: the mail goes out from ITS address.
        this.fromActorId = actorId;
        const mc = contactId ? game.nightcity?.masterContactService?.getContact?.(contactId) : null;
        this.fromContact = mc ? { id: mc.id, name: mc.name, email: mc.email, portrait: mc.portrait } : null;
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
        ? 'Hide the whole message' : 'Show the whole message';
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

  static async _onAttachMedia(event, target) {
    // Capture a media source — a direct file/URL or a YouTube/Vimeo link.
    // Rendered as an inline player in the viewer (see resolveMediaEmbed).
    const content = `
      <div class="ncm-media-dialog" style="display:flex;flex-direction:column;gap:8px;font-family:var(--ncm-font-body,sans-serif);">
        <p style="margin:0;font-size:12px;color:#8888a0;">Paste a direct .mp4/.webm/.mp3/.ogg URL, a YouTube/Vimeo link, or browse for a file.</p>
        <div style="display:flex;gap:6px;">
          <input type="text" name="mediaUrl" placeholder="https://… or file path" style="flex:1;min-width:0;" autofocus />
          <button type="button" data-browse style="flex:0 0 auto;width:auto;"><i class="fas fa-folder-open"></i></button>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;">
          Type
          <select name="mediaType" style="flex:1;">
            <option value="video">Video</option>
            <option value="audio">Audio</option>
          </select>
          <span style="font-size:11px;color:#8888a0;">(auto-detected for files & links)</span>
        </label>
      </div>`;

    let result = null;
    const dialog = playerDialog({
      title: 'Embed Media',
      content,
      buttons: {
        attach: {
          icon: '<i class="fas fa-photo-film"></i>',
          label: 'Attach',
          callback: (html) => {
            const root = html instanceof jQuery ? html[0] : html;
            const url = root.querySelector('[name="mediaUrl"]')?.value?.trim() || '';
            const mediaType = root.querySelector('[name="mediaType"]')?.value || 'video';
            if (url) result = { url, mediaType };
          },
        },
        cancel: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
      },
      default: 'attach',
      render: (html) => {
        const root = html instanceof jQuery ? html[0] : html;
        const input = root.querySelector('[name="mediaUrl"]');
        const typeSel = root.querySelector('[name="mediaType"]');
        root.querySelector('[data-browse]')?.addEventListener('click', () => {
          const pickerType = typeSel?.value === 'audio' ? 'audio' : 'video';
          new FilePicker({
            type: pickerType,
            current: input?.value || '',
            callback: (path) => { if (input) input.value = path; },
          }).render(true);
        });
      },
    });
    dialog.render(true);

    // Wait for the dialog to close, then act on the captured result
    await new Promise((resolve) => {
      const origClose = dialog.close.bind(dialog);
      dialog.close = (...args) => { resolve(); return origClose(...args); };
    });

    if (!result) return;

    const name = result.url.split(/[?#]/)[0].split('/').pop() || 'Media';
    this.attachments.push({
      name,
      size: '',
      icon: result.mediaType === 'audio' ? 'fa-music' : 'fa-film',
      isMedia: true,
      mediaUrl: result.url,
      mediaType: result.mediaType,
      isEddies: false,
      encrypted: this.encryptionEnabled,
    });
    this.render(true);
  }

  static async _onAttachShard(event, target) {
    const actor = game.actors.get(this.fromActorId);
    const isGM = game.user.isGM;

    // Convert Foundry Items to plain objects for display
    // `uuid` is what the recipient resolves: an item in an actor's inventory
    // has an id that only means something inside THAT actor, so a bare id
    // sent from a character's gear died as "shard not found" on the other end.
    const toShardEntry = (item, ownerName = '') => ({
      id: item.id,
      uuid: item.uuid,
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

    // Deduplicate by uuid — an embedded item's id is only unique inside its actor (two characters can carry the same id)
    const seen = new Set();
    allShards = allShards.filter(s => {
      if (seen.has(s.uuid)) return false;
      seen.add(s.uuid);
      return true;
    });

    if (allShards.length === 0) {
      ui.notifications.info(isGM
        ? `No ${T('many', 'lower')} found in any inventory or world items.`
        : `No ${T('many', 'lower')} in your inventory.`);
      return;
    }

    // The shared searchable picker (the composer's last hand-rolled list, 2026-10-29): art, whose it is, a chip per
    // owner, already-attached ones greyed, several at once.
    const mine = actor?.name || '';
    const entries = allShards.map(s => ({
      id: s.uuid, name: s.name, img: s.img,
      sub: s.ownerName === 'World' ? 'World item' : s.ownerName,
      group: s.ownerName === 'World' ? 'World items' : (s.ownerName && s.ownerName === mine ? 'Your gear' : 'Other characters'),
    }));
    const attached = new Set(this.attachments.filter(a => a.itemUuid || a.itemId).map(a => a.itemUuid || allShards.find(x => x.id === a.itemId)?.uuid).filter(Boolean));
    const picks = await showNamePicker({
      title: `Attach ${T('one')}`, hint: isGM ? `${T('many')} in every inventory and the world.` : `${T('many')} you carry.`,
      entries, multi: true, taken: attached, takenLabel: 'attached', placeholder: 'search…', admin: isGM,
    });
    if (!Array.isArray(picks) || !picks.length) return;
    for (const p of picks) {
      const item = allShards.find(x => x.uuid === p.id);
      if (!item || this.attachments.some(a => (a.itemUuid || '') === item.uuid)) continue;
      this.attachments.push({
        name: `${item.name}.shard`,
        size: '',
        icon: 'fa-microchip',
        itemId: item.id,
        itemUuid: item.uuid,
        isEddies: false,
        encrypted: this.encryptionEnabled,
      });
    }
    this.render(true);
  }

  static _onAttachEddies(event, target) {
    if (this.terminalSend && !this.terminalSend.own) return ui.notifications.warn(`You're writing as ${this.terminalSend.username} — their money isn't yours to send.`);
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

    playerDialog({
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
          // A bare <code>: the editor and the viewer both style it from --ncm-* tokens.
          // (The old inline literal hex/font ignored the theme and would be stripped by
          // the render-time cleaner anyway.)
          const safe = selectedText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          document.execCommand('insertHTML', false, `<code>${safe}</code>`);
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

    playerDialog({
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
      const dd = String(dt.getUTCDate()).padStart(2, '0');
      const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const yyyy = dt.getUTCFullYear();
      const hh = String(dt.getUTCHours()).padStart(2, '0');
      const min = String(dt.getUTCMinutes()).padStart(2, '0');
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

    playerDialog({
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

  // ─── The clean revision: drawer · preview · drafts · templates ──────

  /** ONE drawer under the delivery chips; clicking its chip again closes it. */
  static _onToggleDrawer(event, target) {
    const key = target?.dataset?.drawer || null;
    this._syncFormData();
    this._drawer = (this._drawer === key) ? null : key;
    this.render(true);
  }

  /** GM: swap the form for what the recipient will open (state is kept — a re-render). */
  static _onTogglePreview(event, target) {
    if (!game.user.isGM) return;
    this._syncFormData();
    this._preview = !this._preview;
    this._closeTemplatesMenu();
    this.render(true);
  }

  static _onOpenDrafts(event, target) {
    this._openDraftInPlace();
  }

  // ── Templates (GM) ──

  static _onToggleTemplates(event, target) {
    if (!game.user.isGM) return;
    const menu = this.element?.querySelector('[data-id="tpl-menu"]');
    if (!menu) return;
    if (!menu.classList.contains('ncm-hidden')) { this._closeTemplatesMenu(); return; }
    menu.classList.remove('ncm-hidden');
    target?.classList.add('is-on');
    this._tplCloser = (e) => {
      if (menu.contains(e.target) || target?.contains(e.target)) return;
      this._closeTemplatesMenu();
    };
    requestAnimationFrame(() => document.addEventListener('click', this._tplCloser, true));
  }

  _closeTemplatesMenu() {
    this.element?.querySelector('[data-id="tpl-menu"]')?.classList.add('ncm-hidden');
    this.element?.querySelector('[data-action="toggleTemplates"]')?.classList.remove('is-on');
    if (this._tplCloser) {
      document.removeEventListener('click', this._tplCloser, true);
      this._tplCloser = null;
    }
  }

  /** Insert: the shared picker over the templates, then fill the composer. */
  static async _onTplInsert(event, target) {
    if (!game.user.isGM) return;
    this._closeTemplatesMenu();
    const svc = this.messageTemplateService;
    const list = svc?.getAll?.() || [];
    if (!list.length) return ui.notifications.info('No message templates yet — write one and save it from this menu.');
    const Svc = svc.constructor;
    const pick = await showNamePicker({
      title: 'Insert a template', hint: 'Fills an empty subject and the delivery options the template carries.',
      entries: list.map(t => ({ id: t.id, name: t.name, sub: Svc.summary(t), img: 'icons/svg/book.svg' })),
      chips: false, admin: false, placeholder: 'search templates…', closeLabel: 'Cancel',
    });
    if (!pick?.id) return;
    const t = svc.get(pick.id);
    if (t) await this._insertTemplate(t);
  }

  /**
   * Apply a template: an empty subject takes the template's; priority, lock and
   * self-destruct follow it; the body asks Replace / Append when the editor
   * already has text (the Import-from-Journal precedent).
   */
  async _insertTemplate(t) {
    this._syncFormData();
    if (!this.subject.trim() && t.subject) this.subject = t.subject;
    if (t.priority) this.priority = t.priority;
    if (t.encryption) {
      this.encryptionEnabled = !!t.encryption.enabled;
      if (t.encryption.enabled) {
        this.encryptionDV = t.encryption.dv || this.encryptionDV;
        this.encryptionType = t.encryption.type || 'ICE';
        this.encryptionFailureMode = t.encryption.failureMode || 'nothing';
      }
    }
    if (t.selfDestruct) {
      this.selfDestructEnabled = !!t.selfDestruct.enabled;
      if (t.selfDestruct.enabled) this.selfDestructMode = t.selfDestruct.mode || 'after_read';
    }
    const tplBody = String(t.body || '');
    if (tplBody) {
      const hasText = this._getEditorText().trim().length > 0;
      let how = 'replace';
      if (hasText) {
        how = await new Promise((resolve) => {
          playerDialog({
            title: 'Insert template',
            content: `<p>The message already has text. Put the template's body in place of it, or after it?</p>`,
            buttons: {
              replace: { icon: '<i class="fas fa-rotate"></i>', label: 'Replace', callback: () => resolve('replace') },
              append: { icon: '<i class="fas fa-arrow-down"></i>', label: 'Append', callback: () => resolve('append') },
              cancel: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel', callback: () => resolve(null) },
            },
            default: 'append',
            close: () => resolve(null),
          }).render(true);
        });
        if (!how) return;
      }
      this.body = how === 'append' ? `${this.body}<p><br></p>${tplBody}` : tplBody;
    }
    this.render(true);
    ui.notifications.info(`NCM | Template "${t.name}" inserted.`);
  }

  /** Save what is in the composer now as a template (a known name asks Overwrite). */
  static async _onTplSave(event, target) {
    if (!game.user.isGM) return;
    this._closeTemplatesMenu();
    this._syncFormData();
    const svc = this.messageTemplateService;
    if (!svc) return;
    const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const name = await adminPrompt({
      title: 'Save as a template',
      content: `<p>Name this template. The subject, body, priority, lock and self-destruct settings are saved with it.</p><input type="text" name="tplName" value="${esc(this.subject)}" placeholder="e.g. Bounty notice" autocomplete="off" style="width:100%" />`,
      label: 'Save',
      callback: (html) => (html instanceof jQuery ? html[0] : html).querySelector('[name="tplName"]')?.value?.trim() || '',
      rejectClose: false,
    });
    if (!name) return;
    const existing = svc.findByName(name);
    if (existing) {
      const yes = await adminConfirm({
        title: 'Overwrite template?',
        content: `<p>A template called "${esc(name)}" exists. Replace it with this message?</p>`,
      });
      if (!yes) return;
    }
    try {
      const { overwrote } = await svc.save({
        name, subject: this.subject, body: this.body, priority: this.priority,
        encryption: { enabled: this.encryptionEnabled, dv: this.encryptionDV, type: this.encryptionType, failureMode: this.encryptionFailureMode },
        selfDestruct: { enabled: this.selfDestructEnabled, mode: this.selfDestructMode },
      });
      ui.notifications.info(`NCM | Template "${name}" ${overwrote ? 'updated' : 'saved'}.`);
      this.render(true);
    } catch (e) {
      ui.notifications.error(e.message || 'Could not save the template.');
    }
  }

  /** Import (the spam-template pattern: hidden file input, envelope or bare array). */
  static _onTplImport(event, target) {
    if (!game.user.isGM) return;
    this._closeTemplatesMenu();
    const svc = this.messageTemplateService;
    if (!svc) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) { input.remove(); return; }
      try {
        const payload = JSON.parse(await file.text());
        const { imported, skipped } = await svc.importTemplates(payload);
        ui.notifications.info(`Imported ${imported} template(s).${skipped ? ` ${skipped} skipped (same name or invalid).` : ''}`);
        this.render(true);
      } catch (err) {
        console.error('NCM | Import message templates failed:', err);
        ui.notifications.error(err.message || 'Failed to parse JSON file.');
      } finally {
        input.remove();
      }
    });
    input.click();
  }

  /** Export every template as a downloadable JSON envelope. */
  static _onTplExport(event, target) {
    if (!game.user.isGM) return;
    this._closeTemplatesMenu();
    const svc = this.messageTemplateService;
    if (!svc) return;
    const payload = svc.exportTemplates();
    if (!payload.templates.length) return ui.notifications.warn('No templates to export.');
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-message-templates-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info(`Exported ${payload.templates.length} template(s).`);
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

    this._syncAnonFields();
  }

  // ─── Helpers ──────────────────────────────────────────────

  /** Whether the Anonymous Send feature is enabled in world settings. */
  _isAnonFeatureEnabled() {
    try { return game.settings.get(MODULE_ID, 'anonSendEnabled') !== false; } catch { return true; }
  }

  /**
   * The address the current From identity will write from — the same precedence
   * `MessageService._senderEmailFor` stamps at send: an actor's registered flag,
   * then its master-directory entry, else blank (the service synthesizes
   * name@nightcity.net). An explicit master-contact pick uses that contact's
   * address. Shown in the header and the signature so the GM sees what will
   * actually go out — before this an actor-backed NPC showed blank/synthesized
   * even when the directory had a real address for it.
   * @returns {string}
   */
  /** Activity Log row for a send-as from a terminal (the machine's `accountMail.log`). */
  _logTerminalSend() {
    try {
      let item = null;
      try { item = fromUuidSync(this.terminalSend.itemUuid); } catch { item = null; }
      const cfg = item ? game.nightcity?.terminalService?.getConfig?.(item) : null;
      if (cfg && cfg.accountMail?.log === false) return;
      const op = resolveOperator();
      game.nightcity?.traceService?.logSuccess?.({
        actor: op, action: 'send-as', hostItem: item, severity: 'minor',
        source: `${op?.name || game.user.name} sent mail as ${this.terminalSend.username}`,
      });
    } catch (e) { console.warn('NCM | send-as log failed', e); }
  }

  _fromEmail() {
    if (!this.fromActorId) return this.fromContact?.email || '';
    // An identity picked in Send-as (or a reply sent as the alias it came to) wins.
    if (this.fromContact?.email) return this.fromContact.email;
    // A starred main identity beats a registered address left from before a move.
    const starred = game.nightcity?.masterContactService?.getByActorId?.(this.fromActorId);
    if (starred?.primaryIdentity && starred.email && !game.actors?.get(this.fromActorId)?.hasPlayerOwner) return starred.email;
    const flagged = this.contactRepo?.getActorEmail(this.fromActorId) || '';
    if (flagged) return flagged;
    const mcs = game.nightcity?.masterContactService;
    const entry = (this.fromContact?.id && mcs?.getContact?.(this.fromContact.id))
      || mcs?.getByActorId?.(this.fromActorId);
    return entry?.email || '';
  }

  _getDefaultFromActor() {
    if (game.user.character) return game.user.character.id;
    const owned = game.actors?.find(a => a.isOwner && isSelectableCharacter(a));
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

    const viaNet = (game.user.isGM && this.sendNetworkId) ? this.networkService?.getNetwork?.(this.sendNetworkId) : null;
    const netName = (viaNet || this.networkService?.currentNetwork)?.name?.toUpperCase() || 'CITINET';
    const recipientName = this.recipients.length > 1
      ? `${this.recipients[0].name} +${this.recipients.length - 1}`
      : (this.recipients.length > 0 ? this.recipients[0].name : '—');

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
        const sig = viaNet ? (viaNet.signalStrength ?? 100) : (this.networkService?.signalStrength ?? 100);
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
        const title = successEl.querySelector('.ncm-composer__send-success-text');
        const detail = el.querySelector('[data-id="send-success-detail"]');
        successEl.classList.toggle('ncm-composer__send-success--queued', !!details.queued);
        if (details.queued) {
          if (title) title.textContent = 'Message queued';
          if (detail) {
            detail.textContent = details.reason === 'dead_zone'
              ? `No signal here — ${recipientName} will receive it once you are back in network range.`
              : `Your GM is offline — it will be sent to ${recipientName} when they connect.`;
          }
        } else {
          if (title) title.textContent = 'Message sent';
          if (detail) {
            const time = formatCyberDate(this.timeService?.getCurrentTime?.() || new Date().toISOString());
            const who = details.count > 1 ? `${details.count} recipients` : recipientName;
            detail.textContent = `Delivered to ${who} via ${netName} · ${time}`;
          }
        }
      }
      // Hold for user to see success (a little longer for the queued copy — it
      // is a sentence the player should actually read)
      await new Promise(r => setTimeout(r, details.queued ? 2600 : 1500));

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
    const now = game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now();
    switch (this.selfDestructMode) {
      case '1h': return new Date(now + 3600000).toISOString();
      case '6h': return new Date(now + 21600000).toISOString();
      case '24h': return new Date(now + 86400000).toISOString();
      case 'after_read':
      default: return null; // handled on read
    }
  }

}
