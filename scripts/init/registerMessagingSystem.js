/**
 * Register Messaging System
 * @file scripts/init/registerMessagingSystem.js
 * @module cyberpunkred-messenger
 * @description Phase 2 — Messaging system initialization.
 *              Registers repositories, services, socket handlers,
 *              and wires UI launch functions to real Application classes.
 */

import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { log, isGM, getPlayerActor } from '../utils/helpers.js';

// Data layer
import { MessageRepository } from '../data/MessageRepository.js';
import { ContactRepository } from '../data/ContactRepository.js';

// Services
import { MessageService } from '../services/MessageService.js';
import { NotificationService } from '../services/NotificationService.js';

// Integrations
import { SocketHandlers } from '../integrations/SocketHandlers.js';

// UI Applications
import { MessageViewerApp } from '../ui/MessageViewer/MessageViewerApp.js';
import { MessageComposerApp } from '../ui/MessageComposer/MessageComposerApp.js';
import { ContactManagerApp } from '../ui/ContactManager/ContactManagerApp.js';

// Verification
import { Phase2Verification } from '../tests/Phase2Verification.js';

/**
 * Track open application instances for reuse / singleton-per-actor behavior
 * @type {Map<string, Application>}
 */
/** @type {MessageViewerApp|null} Singleton viewer instance */
let _activeViewer = null;
const _openComposers = new Map();
const _openContacts = new Map();

export function registerMessagingSystem(initializer) {

  // ═══════════════════════════════════════════════════════════════
  //  READY PHASE — Priority 48: Repositories
  // ═══════════════════════════════════════════════════════════════

  initializer.register('ready', 48, 'Message repositories', () => {
    const messageRepo = new MessageRepository();
    const contactRepo = new ContactRepository();

    // Expose on namespace for service injection
    game.nightcity.messageRepository = messageRepo;
    game.nightcity.contactRepository = contactRepo;

    log.info('Message & Contact repositories created');
  });

  // ═══════════════════════════════════════════════════════════════
  //  READY PHASE — Priority 49: Auto-repair inbox permissions (GM)
  // ═══════════════════════════════════════════════════════════════

  initializer.register('ready', 49, 'Inbox permission repair', async () => {
    if (!game.user.isGM) return;
    const repo = game.nightcity.messageRepository;
    if (!repo) return;
    try {
      await repo.repairAllInboxPermissions();
    } catch (err) {
      console.warn('NCM | Inbox permission repair failed:', err);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  READY PHASE — Priority 50: MessageService + NotificationService
  // ═══════════════════════════════════════════════════════════════

  initializer.register('ready', 50, 'MessageService', () => {
    const messageService = new MessageService();
    game.nightcity.messageService = messageService;
    log.info('MessageService initialized');
  });

  initializer.register('ready', 52, 'NotificationService', () => {
    const notificationService = new NotificationService();
    notificationService.init();
    game.nightcity.notificationService = notificationService;
    log.info('NotificationService initialized');
  });

  // ═══════════════════════════════════════════════════════════════
  //  READY PHASE — Priority 100: Socket Handlers
  //  (Must run after SocketManager.initialize at priority 100 in
  //   registerReadyServices — register at 101 to guarantee order)
  // ═══════════════════════════════════════════════════════════════

  initializer.register('ready', 101, 'Messaging socket handlers', () => {
    SocketHandlers.register();
    log.info('Messaging socket handlers registered');
  });

  // ═══════════════════════════════════════════════════════════════
  //  READY PHASE — Priority 112: UI Launch Functions
  //  (Overrides the Phase 1 stubs registered at priority 110)
  // ═══════════════════════════════════════════════════════════════

  initializer.register('ready', 112, 'Messaging UI launchers', () => {
    const ns = game.nightcity;

    /**
     * Open the inbox for an actor. Only ONE viewer window exists (singleton).
     * If already open for a different actor, switches the actor and re-renders.
     * @param {string} [actorId] — Falls back to user's primary character
     * @param {string} [messageId] — If provided, auto-selects this message
     */
    /**
     * Open the inbox for an actor. Reuses existing window if already open.
     * @param {string} [actorId] — Falls back to user's primary character
     * @param {string} [messageId] — If provided, auto-selects this message
     * @param {object} [options]
     * @param {string} [options.filter] — Force a specific filter tab ('inbox' | 'sent' | etc.)
     */
    ns.openInbox = (actorId, messageId, options = {}) => {
      const resolvedActorId = _resolveActorId(actorId);
      if (!resolvedActorId) return;

      // ── Email setup intercept ──
      // If player has no email and setup is required, show setup flow first
      if (!game.user.isGM) {
        const emailService = game.nightcity?.emailService;
        if (emailService?.isSetupRequired()) {
          const actor = game.actors.get(resolvedActorId);
          if (actor && !emailService.hasEmail(actor)) {
            // Launch setup flow, then re-open inbox on completion
            game.nightcity.openEmailSetup(actor).then(email => {
              if (email) {
                // Setup complete — now open the inbox
                ns.openInbox(resolvedActorId, messageId, options);
              }
            });
            return;
          }
        }
      }

      // Auto-detect sent messages from messageId suffix
      let filterHint = options.filter || 'inbox';
      if (messageId && messageId.endsWith('-sent') && filterHint === 'inbox') {
        filterHint = 'sent';
      }

      // Singleton — find any existing viewer
      let viewer = _activeViewer;

      // Safety: check if viewer is actually alive (element in DOM)
      if (viewer && (!viewer.rendered || !viewer.element?.closest('body'))) {
        _activeViewer = null;
        viewer = null;
      }

      if (viewer && viewer.rendered) {
        const isSameActor = viewer.actorId === resolvedActorId;

        if (isSameActor) {
          // Same actor — bring to front and select message
          viewer.bringToFront();
          if (messageId) {
            viewer.currentFilter = filterHint;
            viewer.currentPage = 1;
            viewer.selectedMessageId = messageId;
            viewer._cachedMessages = null; // force reload to pick up filter change
            viewer.render(true);
          }
          return viewer;
        }

        // Different actor — switch the viewer's actor, clear caches, re-render
        viewer.actorId = resolvedActorId;
        viewer.selectedMessageId = messageId ?? null;
        viewer._cachedMessages = null;
        viewer._cachedContacts = null;
        viewer.currentFilter = filterHint;
        viewer.currentPage = 1;
        viewer.bringToFront();
        viewer.render(true);
        return viewer;
      }

      // No existing viewer or it's closed — create new
      viewer = new MessageViewerApp({
        actorId: resolvedActorId,
        selectedMessageId: messageId ?? null,
      });
      // Belt-and-suspenders: set selectedMessageId AFTER construction
      // to ensure class field initializer doesn't override constructor assignment
      if (messageId) {
        viewer.selectedMessageId = messageId;
      }
      // Set filter before first render if provided
      if (messageId && filterHint !== 'inbox') {
        viewer.currentFilter = filterHint;
      }

      _activeViewer = viewer;

      // Clean up tracking on close — with error guard
      const origClose = viewer.close.bind(viewer);
      viewer.close = async (...args) => {
        if (_activeViewer === viewer) _activeViewer = null;
        try {
          return await origClose(...args);
        } catch (err) {
          console.warn('NCM | Error during inbox close:', err);
          _activeViewer = null;
        }
      };

      // Backup: also hook _onClose for Foundry's internal close path
      const origOnClose = viewer._onClose?.bind(viewer);
      viewer._onClose = (...args) => {
        if (_activeViewer === viewer) _activeViewer = null;
        if (origOnClose) return origOnClose(...args);
      };

      viewer.render(true);
      return viewer;
    };

    /**
     * Open the message composer.
     * @param {object} [options]
     * @param {string} [options.mode='compose'] — 'compose' | 'reply' | 'forward'
     * @param {string} [options.fromActorId] — Sender actor (falls back to user's character)
     * @param {string} [options.toActorId] — Pre-fill recipient
     * @param {string} [options.subject] — Pre-fill subject
     * @param {string} [options.body] — Pre-fill body
     * @param {string} [options.priority='normal']
     * @param {object} [options.originalMessage] — For reply/forward
     */
    ns.composeMessage = (options = {}) => {
      // Resolve sender — actor or contact
      let fromActorId = null;
      let fromContactId = options.fromContactId || null;

      if (options.fromActorId || options.actorId) {
        fromActorId = _resolveActorId(options.fromActorId || options.actorId);
        if (!fromActorId && !isGM()) return;
      } else if (options.fromContact) {
        // Direct contact object (from GM Contact Manager "Send As")
        fromContactId = options.fromContact.id;
      } else {
        fromActorId = _resolveActorId(null); // fallback to user's character
        if (!fromActorId && !isGM()) return;
      }

      // ── Email setup intercept ──
      if (!game.user.isGM && fromActorId) {
        const emailService = game.nightcity?.emailService;
        if (emailService?.isSetupRequired()) {
          const actor = game.actors.get(fromActorId);
          if (actor && !emailService.hasEmail(actor)) {
            game.nightcity.openEmailSetup(actor).then(email => {
              if (email) ns.composeMessage(options);
            });
            return;
          }
        }
      }

      const composerId = foundry.utils.randomID(8);
      const composer = new MessageComposerApp({
        mode: options.mode ?? 'compose',
        fromActorId: fromActorId,
        fromContactId: fromContactId,
        fromContact: options.fromContact ?? null,
        toActorId: options.toActorId ?? null,
        toContactId: options.toContactId ?? null,
        to: options.to ?? null,
        subject: options.subject ?? '',
        body: options.body ?? '',
        priority: options.priority ?? 'normal',
        originalMessage: options.originalMessage ?? null,
        threadId: options.threadId ?? null,
        inReplyTo: options.inReplyTo ?? null,
      });

      // Track and clean up
      _openComposers.set(composerId, composer);
      const origClose = composer.close.bind(composer);
      composer.close = async (...args) => {
        _openComposers.delete(composerId);
        return origClose(...args);
      };

      composer.render(true);
      return composer;
    };

    // Bridge: also expose on ns.messenger for callers using that path
    if (ns.messenger) {
      ns.messenger.composeMessage = ns.composeMessage;
    }

    // Alias: openComposer → composeMessage (used by admin panel)
    ns.openComposer = ns.composeMessage;

    /**
     * Open the contact manager for an actor.
     * @param {string} [actorId] — Falls back to user's primary character
     */
    ns.openContacts = (actorId) => {
      const resolvedActorId = _resolveActorId(actorId);
      if (!resolvedActorId) return;

      // ── Email setup intercept ──
      if (!game.user.isGM) {
        const emailService = game.nightcity?.emailService;
        if (emailService?.isSetupRequired()) {
          const actor = game.actors.get(resolvedActorId);
          if (actor && !emailService.hasEmail(actor)) {
            game.nightcity.openEmailSetup(actor).then(email => {
              if (email) ns.openContacts(resolvedActorId);
            });
            return;
          }
        }
      }

      const key = `contacts-${resolvedActorId}`;
      let manager = _openContacts.get(key);

      if (manager && manager.rendered) {
        manager.bringToFront();
        return manager;
      }

      manager = new ContactManagerApp({
        actorId: resolvedActorId,
      });

      _openContacts.set(key, manager);
      const origClose = manager.close.bind(manager);
      manager.close = async (...args) => {
        _openContacts.delete(key);
        return origClose(...args);
      };

      manager.render(true);
      return manager;
    };

    // ─── Character Select / Entry Point ───
    /** @type {import('../ui/CharacterSelect/CharacterSelectApp.js').CharacterSelectApp|null} */
    let _characterSelectApp = null;

    /**
     * Play the NCM boot splash — a frameless overlay injected into document.body.
     * Resolves after the animation completes (~2s).
     */
    function _playBootSplash() {
      return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'ncm-boot-splash';
        overlay.innerHTML = `
          <div class="ncm-boot-splash__bg"></div>
          <div class="ncm-boot-splash__content">
            <div class="ncm-boot-splash__icon" data-el="icon">
              <i class="fas fa-satellite-dish"></i>
            </div>
            <div class="ncm-boot-splash__title">Night City Messenger</div>
            <div class="ncm-boot-splash__subtitle" data-el="subtitle">v4.1 // Initializing</div>
            <div class="ncm-boot-splash__bar-wrap">
              <div class="ncm-boot-splash__bar-track">
                <div class="ncm-boot-splash__bar-fill" data-el="bar"></div>
              </div>
              <div class="ncm-boot-splash__bar-status">
                <span class="ncm-boot-splash__bar-label" data-el="label">Loading services...</span>
                <span class="ncm-boot-splash__bar-pct" data-el="pct">0%</span>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);

        // Force reflow so the initial state renders before animations start
        overlay.offsetHeight;

        const bar = overlay.querySelector('[data-el="bar"]');
        const label = overlay.querySelector('[data-el="label"]');
        const pct = overlay.querySelector('[data-el="pct"]');
        const icon = overlay.querySelector('[data-el="icon"]');
        const subtitle = overlay.querySelector('[data-el="subtitle"]');

        const steps = [
          { pct: 18, label: 'Loading services...', t: 0 },
          { pct: 35, label: 'Scanning network...', t: 350 },
          { pct: 58, label: 'Resolving identities...', t: 700 },
          { pct: 78, label: 'Validating inboxes...', t: 1050 },
          { pct: 94, label: 'Synchronizing...', t: 1400 },
          { pct: 100, label: 'Ready', t: 1700, done: true },
        ];

        steps.forEach(step => {
          setTimeout(() => {
            if (!overlay.parentNode) return;
            bar.style.width = `${step.pct}%`;
            label.textContent = step.label;
            pct.textContent = `${step.pct}%`;

            if (step.done) {
              bar.classList.add('done');
              label.classList.add('done');
              pct.classList.add('done');
              icon.classList.add('done');
              icon.querySelector('i').className = 'fas fa-check';
              subtitle.textContent = 'v4.1 // Systems online';
              subtitle.classList.add('done');
            }
          }, step.t);
        });

        // Fade out and resolve
        setTimeout(() => {
          overlay.classList.add('fade-out');
          setTimeout(() => {
            overlay.remove();
            resolve();
          }, 300);
        }, 2100);
      });
    }

    /**
     * Main NCM entry point. Checks session memory:
     * - If lastCharacterId exists and actor is valid → open inbox directly
     * - Otherwise → play boot splash, then open CharacterSelectApp
     */
    ns.openNCM = async () => {
      // Check for session memory
      const lastId = game.user.getFlag(MODULE_ID, 'lastCharacterId');
      if (lastId) {
        const actor = game.actors.get(lastId);
        if (actor && (actor.isOwner || isGM())) {
          ns.openInbox(lastId);
          return;
        }
        try { await game.user.unsetFlag(MODULE_ID, 'lastCharacterId'); } catch { /* ok */ }
      }

      // Play boot splash, then show character select
      await _playBootSplash();
      try {
        await ns.showCharacterSelect();
      } catch (err) {
        console.error('NCM | Failed to open character select:', err);
        ui.notifications.error('NCM | Failed to open character select. Check console.');
      }
    };

    /**
     * Open the character select screen directly (no boot splash).
     * Used by re-login and after boot splash.
     */
    ns.showCharacterSelect = async () => {
      if (_characterSelectApp?.rendered) {
        _characterSelectApp.bringToFront();
        return _characterSelectApp;
      }

      try {
        const mod = await import('../ui/CharacterSelect/CharacterSelectApp.js');
        const CharacterSelectApp = mod.CharacterSelectApp || mod.default;
        _characterSelectApp = new CharacterSelectApp();

        const origClose = _characterSelectApp.close.bind(_characterSelectApp);
        _characterSelectApp.close = async (...args) => {
          _characterSelectApp = null;
          return origClose(...args);
        };

        _characterSelectApp.render(true);
        return _characterSelectApp;
      } catch (err) {
        console.error('NCM | CharacterSelectApp import/render failed:', err);
        _characterSelectApp = null;
        throw err;
      }
    };

    /**
     * Re-login: clear session memory and show character select (no boot).
     */
    ns.reLogin = async () => {
      try { await game.user.unsetFlag(MODULE_ID, 'lastCharacterId'); } catch { /* ok */ }

      if (_activeViewer?.rendered) {
        await _activeViewer.close();
        _activeViewer = null;
      }

      ns.showCharacterSelect();
    };

    log.info('Messaging UI launchers registered (replaced Phase 1 stubs)');
  });

  // ═══════════════════════════════════════════════════════════════
  //  READY PHASE — Priority 114: EventBus Wiring
  //  Wire up cross-service event reactions
  // ═══════════════════════════════════════════════════════════════

  initializer.register('ready', 114, 'Messaging event wiring', () => {
    const { eventBus, notificationService, soundService } = game.nightcity;

    // When a message is received, show notification and update badge
    eventBus.on(EVENTS.MESSAGE_RECEIVED, (data) => {
      if (notificationService) {
        notificationService.showMessageNotification(data);
        notificationService.refreshBadge();
      }
      if (soundService) {
        const soundKey = data.priority === 'critical' ? 'receive-urgent' : 'receive';
        soundService.play(soundKey);
      }
    });

    // When a message is read, update the badge count
    eventBus.on(EVENTS.MESSAGE_READ, () => {
      if (notificationService) {
        notificationService.refreshBadge();
      }
    });

    // When a message is deleted, update the badge count
    eventBus.on(EVENTS.MESSAGE_DELETED, () => {
      if (notificationService) {
        notificationService.refreshBadge();
      }
    });

    // Play send sound on message sent
    eventBus.on(EVENTS.MESSAGE_SENT, () => {
      if (soundService) {
        soundService.play('send');
      }
    });

    // Open composer when requested via EventBus (e.g., from chat card reply)
    eventBus.on(EVENTS.COMPOSER_OPEN, (options) => {
      game.nightcity.composeMessage(options);
    });

    log.info('Messaging event wiring complete');
  });

  // ═══════════════════════════════════════════════════════════════
  //  POST-READY PHASE — Priority 20: Initial Badge Count
  // ═══════════════════════════════════════════════════════════════

  initializer.register('postReady', 20, 'Initial unread badge', async () => {
    const { notificationService, messageService } = game.nightcity;
    if (notificationService && messageService) {
      try {
        await notificationService.refreshBadge();
        log.info('Initial unread badge updated');
      } catch (error) {
        log.warn('Failed to set initial unread badge:', error.message);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  POST-READY PHASE — Priority 22: Flush Queued Messages
  //  If there were messages queued while GM was offline, flush now
  // ═══════════════════════════════════════════════════════════════

  initializer.register('postReady', 22, 'Flush message queue', async () => {
    const { messageService } = game.nightcity;
    if (messageService) {
      try {
        await messageService.flushQueue();
      } catch (error) {
        log.warn('Failed to flush message queue:', error.message);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  POST-READY PHASE — Priority 30: Register Phase 2 Verification
  // ═══════════════════════════════════════════════════════════════

  initializer.register('postReady', 30, 'Phase 2 verification', () => {
    game.nightcity.verifyPhase2 = () => Phase2Verification.run();

    // Auto-run in debug mode
    try {
      if (game.settings.get(MODULE_ID, 'debugMode')) {
        Phase2Verification.run();
      }
    } catch {
      // Setting may not be registered
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Resolve an actorId, falling back to the user's primary character.
 * Shows a warning if no valid actor is found.
 * @param {string} [actorId]
 * @returns {string|null}
 * @private
 */
function _resolveActorId(actorId) {
  if (actorId) {
    const actor = game.actors.get(actorId);
    if (actor) {
      // Verify ownership (GM can access any actor)
      if (!actor.isOwner && !isGM()) {
        ui.notifications.warn('NCM | You do not own that character.');
        return null;
      }
      return actorId;
    }

    // Not an actor — check if it's a master contact ID (GM only, virtual inbox)
    if (isGM()) {
      const contact = game.nightcity?.masterContactService?.getContact(actorId);
      if (contact) {
        // Return the contactId as-is — MessageRepository.getInboxJournal handles both
        return actorId;
      }
    }

    ui.notifications.warn('NCM | Actor or contact not found.');
    return null;
  }

  // Fall back to user's primary character
  const playerActor = getPlayerActor();
  if (playerActor) return playerActor.id;

  // GM with no selected character — show a picker or use first available
  if (isGM()) {
    const firstActor = game.actors.contents[0];
    if (firstActor) {
      log.debug('GM defaulting to first actor:', firstActor.name);
      return firstActor.id;
    }
  }

  ui.notifications.warn('NCM | No character assigned. Set your character in User Configuration.');
  return null;
}
