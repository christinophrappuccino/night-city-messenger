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
const _openViewers = new Map();
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
  //  READY PHASE — Priority 50: MessageService + NotificationService
  // ═══════════════════════════════════════════════════════════════

  initializer.register('ready', 50, 'MessageService', () => {
    const messageService = new MessageService();
    game.nightcity.messageService = messageService;
    log.info('MessageService initialized');
  });

  initializer.register('ready', 52, 'NotificationService', () => {
    const notificationService = new NotificationService();
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
     * Open the inbox for an actor. Reuses existing window if already open.
     * @param {string} [actorId] — Falls back to user's primary character
     * @param {string} [messageId] — If provided, auto-selects this message
     */
    ns.openInbox = (actorId, messageId) => {
      const resolvedActorId = _resolveActorId(actorId);
      if (!resolvedActorId) return;

      const key = `viewer-${resolvedActorId}`;
      let viewer = _openViewers.get(key);

      if (viewer && viewer.rendered) {
        // Already open — bring to front and optionally select message
        viewer.bringToFront();
        if (messageId) {
          viewer.selectMessage(messageId);
        }
        return viewer;
      }

      // Create new viewer
      viewer = new MessageViewerApp({
        actorId: resolvedActorId,
        selectedMessageId: messageId ?? null,
      });

      // Track instance
      _openViewers.set(key, viewer);

      // Clean up tracking on close
      const origClose = viewer.close.bind(viewer);
      viewer.close = async (...args) => {
        _openViewers.delete(key);
        return origClose(...args);
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
      const fromActorId = _resolveActorId(options.fromActorId);
      if (!fromActorId && !isGM()) return;

      const composerId = foundry.utils.randomID(8);
      const composer = new MessageComposerApp({
        mode: options.mode ?? 'compose',
        fromActorId: fromActorId,
        toActorId: options.toActorId ?? null,
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

    /**
     * Open the contact manager for an actor.
     * @param {string} [actorId] — Falls back to user's primary character
     */
    ns.openContacts = (actorId) => {
      const resolvedActorId = _resolveActorId(actorId);
      if (!resolvedActorId) return;

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
    if (!actor) {
      ui.notifications.warn('NCM | Actor not found.');
      return null;
    }
    // Verify ownership (GM can access any actor)
    if (!actor.isOwner && !isGM()) {
      ui.notifications.warn('NCM | You do not own that character.');
      return null;
    }
    return actorId;
  }

  // Fall back to user's primary character
  const playerActor = getPlayerActor();
  if (playerActor) return playerActor.id;

  // GM with no selected character — show a picker or use first available
  if (isGM()) {
    // GM can open inbox for any actor; if none specified, prompt them
    const firstActor = game.actors.contents[0];
    if (firstActor) {
      log.debug('GM defaulting to first actor:', firstActor.name);
      return firstActor.id;
    }
  }

  ui.notifications.warn('NCM | No character assigned. Set your character in User Configuration.');
  return null;
}
