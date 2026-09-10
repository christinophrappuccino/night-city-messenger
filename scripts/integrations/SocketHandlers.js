/**
 * Socket Handlers
 * @file scripts/integrations/SocketHandlers.js
 * @module night-city-messenger
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

    // ─── Anonymous Trace (Player → GM) ────────────────────
    socketManager.register(SOCKET_OPS.ANON_TRACE_REQUEST, async (data) => {
      if (!game.user.isGM) return;
      log.debug('Socket: anon:traceRequest received for', data?.messageId);
      await messageService.handleAnonTraceRequest(data);
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

    // ─── Trace Complete (Player → GM) ─────────────────────
    socketManager.register(SOCKET_OPS.TRACE_COMPLETE, (data) => {
      if (!game.user.isGM) return;
      log.debug('Socket: trace complete received for', data.actorName, 'on', data.network);
      const eventBus = game.nightcity?.eventBus;
      if (eventBus) {
        eventBus.emit(EVENTS.TRACE_COMPLETE, {
          actorId: data.actorId,
          actorName: data.actorName,
          messageId: data.messageId,
          networkId: data.network,
          scene: data.scene,
        });
      }
    });

    // ─── Log Relay (Player → GM) ──────────────────────────
    // Players relay log-worthy events to the GM so they appear
    // in the persistent access log with the player's actor info.
    socketManager.register(SOCKET_OPS.LOG_RELAY, (data) => {
      if (!game.user.isGM) return;
      const accessLogService = game.nightcity?.accessLogService;
      if (!accessLogService) return;
      log.debug('Socket: log relay received —', data.type, data.actorName);
      accessLogService._push(data);
    });

    // ─── Player Shard Conversion Relay ─────────────────────
    // Players can't create JournalEntries directly — the GM's client
    // receives the request, performs the conversion, and sends back the result.
    socketManager.register(SOCKET_OPS.SHARD_CONVERT_REQUEST, async (data) => {
      if (!game.user.isGM) return;

      const { requestId, itemId, actorId, config, entryData } = data;
      log.info(`Socket: shard conversion request — item ${itemId} from actor ${actorId}`);

      let success = false;
      try {
        // Find the item on the actor
        const actor = game.actors.get(actorId);
        const item = actor?.items?.get(itemId);
        if (!item) throw new Error('Item not found');

        const service = game.nightcity?.dataShardService;
        if (!service) throw new Error('DataShardService not available');

        const result = await service.convertToDataShard(item, config || {});
        success = result.success;
        if (!result.success) {
          log.warn('Shard conversion failed:', result.error);
        } else if (entryData) {
          // Player can't write to the GM-owned shard journal — create the
          // initial entry here on the GM client (non-fatal if it fails).
          const entryResult = await service.addMessage(item, entryData);
          if (!entryResult?.success) log.warn('Initial shard entry failed (non-fatal):', entryResult?.error);
        }
      } catch (err) {
        log.error('Shard conversion relay failed:', err);
      }

      // Send result back
      socketManager.emit(SOCKET_OPS.SHARD_CONVERT_RESULT, { requestId, success });
    });

    // ─── Player Terminal Exfil Relay ─────────────────────
    // Players can't write the GM-owned terminal/inbox/shard journals, so the GM
    // client performs the copy and the result syncs back to the player.
    socketManager.register(SOCKET_OPS.TERMINAL_EXFIL_REQUEST, async (data) => {
      if (!game.user.isGM) return;
      const { requestId, itemUuid, accountId, messageIds, dest, targetActorId, targetItemId, forwarder, frameIndex, aim, userId } = data;
      const svc = game.nightcity?.terminalService;
      let result = { success: false, count: 0 };
      try {
        const item = itemUuid ? fromUuidSync(itemUuid) : null;
        if (!item || !svc) throw new Error('Terminal/service not found');
        if (dest === 'saveFrame') {
          // SAVE FRAME (#37) — capture one feed channel into the player's Agent.
          result = await svc.exfilSaveFrame(item, accountId, messageIds?.[0], frameIndex, targetActorId, aim || '');
        } else if (dest === 'shard') {
          let target = game.items.get(targetItemId);
          if (!target) { for (const a of game.actors) { target = a.items.get(targetItemId); if (target) break; } }
          if (!target) throw new Error('Target item not found');
          result = await svc.exfilToShard(item, accountId, messageIds, target);
        } else if (dest === 'forward') {
          result = await svc.exfilForward(item, accountId, messageIds, targetActorId, forwarder || {});
        } else if (dest === 'wipe') {
          result = await svc.exfilWipe(item, accountId, messageIds);
        } else {
          result = await svc.exfilToInbox(item, accountId, messageIds, targetActorId);
        }
      } catch (err) {
        log.error('Terminal exfil relay failed:', err);
      }
      socketManager.emit(SOCKET_OPS.TERMINAL_EXFIL_RESULT, { requestId, userId, success: !!result.success, count: result.count || 0, dest });
    });

    // ─── Player Terminal Uplink Switch Relay ─────────────
    // The machine's uplink lives in item flags (terminalState.connection), which
    // players can't write on world items — the GM client performs the switch.
    // `authorized: true` = the player just passed the network's join challenge
    // client-side (the shard-relay trust model), so the machine remembers the
    // credential. No RESULT op: the flag write itself syncs to every client and
    // the viewer re-renders off the updateItem hook.
    socketManager.register(SOCKET_OPS.TERMINAL_NET_REQUEST, async (data) => {
      if (!game.user.isGM) return;
      const { itemUuid, networkId, authorized } = data;
      const svc = game.nightcity?.terminalService;
      try {
        const item = itemUuid ? fromUuidSync(itemUuid) : null;
        if (!item || !svc) throw new Error('Terminal/service not found');
        const cfg = svc.getConfig(item).connection || {};
        if (!cfg.allowPlayerSwitching) throw new Error('Player switching disabled for this terminal');
        const result = await svc.setUplink(item, networkId || null, { remember: !!authorized });
        if (!result.success) log.warn('Uplink switch relay rejected:', result.error);
      } catch (err) {
        log.error('Terminal uplink relay failed:', err);
      }
    });

    // ─── Player Terminal Session Relay ─────────────
    // Login / account-switch / logout write terminalState.sessions on the world
    // item, which players can't update ("User Player lacks permission to update
    // Item") — the GM client lands the write. The auth itself already happened
    // client-side (the shard-relay trust model); this only persists the session.
    // No RESULT op: the flag write syncs back and the viewer re-renders off its
    // updateItem hook.
    socketManager.register(SOCKET_OPS.TERMINAL_SESSION_REQUEST, async (data) => {
      if (!game.user.isGM) return;
      const { itemUuid, actorId, updates } = data;
      const svc = game.nightcity?.terminalService;
      try {
        const item = itemUuid ? fromUuidSync(itemUuid) : null;
        if (!item || !svc) throw new Error('Terminal/service not found');
        if (!item.getFlag(MODULE_ID, 'isTerminal')) throw new Error('Not a terminal');
        await svc.applySessionUpdate(item, actorId, updates || {});
      } catch (err) {
        log.error('Terminal session relay failed:', err);
      }
    });

    // Requesting client hears the result → notify the player.
    socketManager.register(SOCKET_OPS.TERMINAL_EXFIL_RESULT, (data) => {
      if (data.userId !== game.user.id) return;
      // The exfil folder is GM-renameable (the `exfilFolderName` setting) — read
      // the label rather than hardcoding it, or the toast and the tab disagree.
      const folder = game.nightcity?.settingsManager?.getExfilFolderName?.() || 'Exfil';
      const verb = {
        shard: `Burned ${data.count} file(s) to a shard.`,
        forward: `Forwarded ${data.count} file(s).`,
        wipe: `Wiped ${data.count} file(s) from the terminal.`,
        saveFrame: `Frame captured — check your ${folder} folder.`,
        inbox: `Downloaded ${data.count} file(s) to your Agent (${folder}).`,
      };
      if (data.success) ui.notifications.info(verb[data.dest] || verb.inbox);
      else ui.notifications.warn('Exfil failed — no GM available or the GM rejected it.');
    });

    // ─── Player Banking Siphon Relay (GM persists the drain / alerts) ──
    socketManager.register(SOCKET_OPS.BANK_SIPHON_REQUEST, async (data) => {
      if (!game.user.isGM) return;
      try {
        const { handleSiphonRequest } = await import('../ui/content/SiphonFlow.js');
        await handleSiphonRequest(data);
      } catch (err) {
        log.error('Bank siphon relay failed:', err);
      }
    });

    // ─── Player Typed-Content Update Relay (eddies claim / credential crack —
    //     the entry lives in a GM-owned journal, so the GM persists the write) ──
    socketManager.register(SOCKET_OPS.CONTENT_UPDATE_REQUEST, async (data) => {
      if (!game.user.isGM) return;
      try {
        const { handleContentUpdateRequest } = await import('../ui/content/SiphonFlow.js');
        await handleContentUpdateRequest(data);
      } catch (err) {
        log.error('Content update relay failed:', err);
      }
    });

    // ─── Player Payload Execution Relay (roll ran client-side; GM applies the
    //     module-native effect + payload state write on the GM-owned host) ──
    socketManager.register(SOCKET_OPS.PAYLOAD_EFFECT_REQUEST, async (data) => {
      if (!game.user.isGM) return;
      try {
        const flow = await import('../ui/content/SiphonFlow.js');
        if (data.outcome === 'kill') await flow.applyPayloadKill({ messageId: data.messageId, actorId: data.actorId });
        else await flow.handlePayloadEffectRequest(data);
      } catch (err) {
        log.error('Payload effect relay failed:', err);
      }
    });

    // ─── Player Upload/Plant Relay (FORGE roll ran client-side; GM installs the
    //     resident on the GM-owned terminalState) ──────────
    socketManager.register(SOCKET_OPS.TERMINAL_RESIDENT_REQUEST, async (data) => {
      if (!game.user.isGM) return;
      try {
        const flow = await import('../ui/content/UploadFlow.js');
        await flow.handleResidentRequest(data);
      } catch (err) {
        log.error('Resident install relay failed:', err);
      }
    });

    // ─── Player Trace Relay (a player tripped a trace; GM records the log + heat
    //     on the GM-owned world settings) ──────────────────
    socketManager.register(SOCKET_OPS.TRACE_REQUEST, async (data) => {
      if (!game.user.isGM) return;
      try {
        await game.nightcity?.traceService?.handleTraceRequest(data);
      } catch (err) {
        log.error('Trace relay failed:', err);
      }
    });

    // ─── Netrunning Tier C adjudication (design §5, hackResolution: 'gm') ───
    // A player's gated action does NOT auto-roll — the GM gets the NetAdjudicator
    // prompt and calls pass/fail; the verdict rides back to the waiting console.
    // CANCEL = the player withdrew while the GM was deciding (closes the prompt).
    socketManager.register(SOCKET_OPS.NET_RESOLVE_REQUEST, async (data) => {
      if (!game.user.isGM) return;
      try {
        const nr = await import('../ui/content/NetResolve.js');
        await nr.handleNetResolveRequest(data);
      } catch (err) {
        log.error('Net adjudication request failed:', err);
      }
    });

    socketManager.register(SOCKET_OPS.NET_RESOLVE_RESULT, async (data) => {
      if (data?.userId !== game.user.id) return;
      try {
        const nr = await import('../ui/content/NetResolve.js');
        nr.handleNetResolveResult(data);
      } catch (err) {
        log.error('Net adjudication result failed:', err);
      }
    });

    socketManager.register(SOCKET_OPS.NET_RESOLVE_CANCEL, async (data) => {
      if (!game.user.isGM) return;
      try {
        const nr = await import('../ui/content/NetResolve.js');
        nr.handleNetResolveCancel(data);
      } catch (err) {
        log.error('Net adjudication cancel failed:', err);
      }
    });

    // GM docked/restored their adjudicator → mirror onto the waiting player's
    // console (the "GM stepped into the run" sync).
    socketManager.register(SOCKET_OPS.NET_RESOLVE_STATE, async (data) => {
      if (data?.userId !== game.user.id) return;
      try {
        const nr = await import('../ui/content/NetResolve.js');
        nr.handleNetResolveState(data);
      } catch (err) {
        log.error('Net adjudication state failed:', err);
      }
    });

    // ─── Forced Lockout Sync (GM → everyone) ─────────────
    // SecurityService lockout state is CLIENT-LOCAL — a GM-side escalation
    // lockout must be mirrored onto every client or the player's own login
    // checks still read "not locked" and they walk right back in. The receiver
    // also kicks any live session on the locked target and toasts the operator.
    socketManager.register(SOCKET_OPS.SECURITY_LOCKOUT, (data) => {
      try {
        game.nightcity?.securityService?.receiveForcedLockout?.(data);
      } catch (err) {
        log.error('Forced lockout sync failed:', err);
      }
    });

    // ─── Targeted Security Toast (GM → specific users) ───
    // Security drama applied on another client (Black ICE damage from a GM
    // escalation) pings the operator's own screen — the EventBus toast is
    // client-local, so without this only the applying client ever saw it.
    socketManager.register(SOCKET_OPS.SECURITY_NOTIFY, (data) => {
      if (!Array.isArray(data?.userIds) || !data.userIds.includes(game.user.id)) return;
      const ns = game.nightcity?.notificationService;
      try {
        if (data.kind === 'blackIce') {
          ns?.showShardBlackICE?.(data.data || {});
          game.nightcity?.soundService?.play?.('black-ice');
        } else if (data.toast) {
          ns?.showToastV2?.(data.toast);
        }
      } catch (err) {
        log.error('Security notify failed:', err);
      }
    });

    // ─── Player Shard Unconvert Relay ────────────────────
    socketManager.register(SOCKET_OPS.SHARD_UNCONVERT_REQUEST, async (data) => {
      if (!game.user.isGM) return;

      const { requestId, itemId, actorId } = data;
      log.info(`Socket: shard unconvert request — item ${itemId} from actor ${actorId}`);

      let success = false;
      try {
        const actor = game.actors.get(actorId);
        const item = actor?.items?.get(itemId);
        if (!item) throw new Error('Item not found');

        const service = game.nightcity?.dataShardService;
        if (!service) throw new Error('DataShardService not available');

        const result = await service.removeDataShard(item);
        success = result?.success !== false;
      } catch (err) {
        log.error('Shard unconvert relay failed:', err);
      }

      socketManager.emit(SOCKET_OPS.SHARD_UNCONVERT_RESULT, { requestId, success });
    });

    log.info('Socket handlers registered');
  }
}
