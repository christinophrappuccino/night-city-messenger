/**
 * Socket Handlers
 * @file scripts/integrations/SocketHandlers.js
 * @module cyberpunkred-messenger
 * @description Wires up socket operations for real-time message relay between clients.
 *              Handles the GM-relayed delivery pipeline, status syncing, and inbox refresh signals.
 */

import { MODULE_ID, SOCKET_OPS, EVENTS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class SocketHandlers {

  /**
   * Register all socket handlers. Called once during ready phase.
   * Pulls services from game.nightcity namespace (all available by priority 100+).
   */
  static register() {
    const socketManager = game.nightcity?.socketManager;
    const messageService = game.nightcity?.messageService;

    if (!socketManager) {
      log.error('SocketHandlers: SocketManager not available');
      return;
    }

    if (!messageService) {
      log.error('SocketHandlers: MessageService not available');
      return;
    }

    // ─── Message Relay (Player → GM) ──────────────────────
    socketManager.register(SOCKET_OPS.MESSAGE_RELAY, async (data) => {
      // Only GM processes relay requests
      if (!game.user.isGM) return;
      log.debug('Socket: message:relay received for', data.messageId);
      await messageService.handleMessageRelay(data);
    });

    // ─── Delivery Confirmation (GM → Sender) ──────────────
    socketManager.register(SOCKET_OPS.MESSAGE_DELIVERED, (data) => {
      // All clients check if they sent this message
      messageService.handleDeliveryConfirmation(data);
    });

    // ─── New Message Notification (GM → Recipient) ────────
    socketManager.register(SOCKET_OPS.MESSAGE_NOTIFY, (data) => {
      // Check if this notification is for an actor we own
      messageService.handleMessageNotification(data);
    });

    // ─── Status Update Sync ───────────────────────────────
    socketManager.register(SOCKET_OPS.MESSAGE_STATUS_UPDATE, (data) => {
      // Refresh UI if we have this actor's inbox open
      const eventBus = game.nightcity.eventBus;
      if (eventBus) {
        eventBus.emit(EVENTS.MESSAGE_STATUS_CHANGED, data);
      }
    });

    // ─── Inbox Refresh Signal ─────────────────────────────
    socketManager.register(SOCKET_OPS.INBOX_REFRESH, (data) => {
      const actor = game.actors.get(data.actorId);
      if (actor?.isOwner) {
        const eventBus = game.nightcity.eventBus;
        if (eventBus) {
          eventBus.emit(EVENTS.INBOX_REFRESH, { actorId: data.actorId });
        }
      }
    });

    // ─── Contact Share Relay (Player → GM) ────────────────
    socketManager.register(SOCKET_OPS.CONTACT_SHARE_RELAY, async (data) => {
      if (!game.user.isGM) return;
      log.debug('Socket: contact:shareRelay received', data.shareId);
      const shareService = game.nightcity?.contactShareService;
      if (shareService) {
        await shareService.handleShareRelay(data);
      }
    });

    // ─── Contact Share Notification (GM → Recipient) ──────
    socketManager.register(SOCKET_OPS.CONTACT_SHARE_NOTIFY, async (data) => {
      const shareService = game.nightcity?.contactShareService;
      if (shareService) {
        await shareService.handleShareNotification(data);
      }
    });

    // ─── Contact Share Confirmation (GM → Sender) ─────────
    socketManager.register(SOCKET_OPS.CONTACT_SHARE_CONFIRM, (data) => {
      const shareService = game.nightcity?.contactShareService;
      if (shareService) {
        shareService.handleShareConfirmation(data);
      }
    });

    log.info('Socket handlers registered');
  }
}
