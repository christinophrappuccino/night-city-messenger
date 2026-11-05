/**
 * Socket Handlers
 * @file scripts/integrations/SocketHandlers.js
 * @module night-city-messenger
 * @description Wires up socket operations for real-time message relay between clients.
 *              Handles the GM-relayed delivery pipeline, status syncing, and inbox refresh signals.
 */

import { ncmNotify } from '../utils/notify.js';
import { MODULE_ID, SOCKET_OPS, EVENTS } from '../utils/constants.js';
import { log, stripMacroRefs, isPrimaryGM, isFromGM, userOwnsActor, canEncode, canEditShard } from '../utils/helpers.js';
import { shardTerm as T, withArticle } from '../utils/shardTerm.js';
import { refreshNcmWindows } from '../utils/forceRefresh.js';

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
    socketManager.register(SOCKET_OPS.MESSAGE_RELAY, async (data, sender) => {
      // Only GM processes relay requests
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)
      log.debug('Socket: message:relay received for', data.messageId);
      // `sender` = the relaying user's id (SocketManager passes it) — the
      // delivery confirmation is addressed back to exactly that client.
      await messageService.handleMessageRelay(data, sender);
    });

    // ─── Anonymous Trace (Player → GM) ────────────────────
    socketManager.register(SOCKET_OPS.ANON_TRACE_REQUEST, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)
      log.debug('Socket: anon:traceRequest received for', data?.messageId);
      await messageService.handleAnonTraceRequest(data, sender);
    });

    // ─── Delivery Confirmation (GM → Sender) ──────────────
    // ─── Held mail (Admin → Messages → Outbox) ──────────
    // Player → GM: what this client is holding (dead zone). GM → player: deliver/cancel.
    socketManager.register(SOCKET_OPS.MESSAGE_QUEUE_SYNC, (data, sender) => {
      if (!game.user.isGM) return;
      messageService.receiveQueueSync?.(data, sender);
    });
    socketManager.register(SOCKET_OPS.MESSAGE_QUEUE_CMD, (data, sender) => {
      // Only a GM may tell a player to drop (and refund) held mail (B3).
      if (game.user.isGM || data?.forUserId !== game.user.id || !isFromGM(sender)) return;
      messageService.handleQueueCommand?.(data);
    });

    socketManager.register(SOCKET_OPS.MESSAGE_DELIVERED, (data, sender) => {
      // All clients check if they sent this message. Only a GM's answer counts:
      // a failure answer now refunds held eddies (B3), so a forged one would mint money.
      if (!isFromGM(sender)) return;
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
    socketManager.register(SOCKET_OPS.CONTACT_SHARE_RELAY, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)
      log.debug('Socket: contact:shareRelay received', data?.shareId);
      const shareService = game.nightcity?.contactShareService;
      if (shareService) {
        await shareService.handleShareRelay(data, sender);
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
    // Nothing in the module sends this any more, so a packet here comes from a modified client.
    // It is kept (the access log has older callers in mind) but rebuilt (audit SEC-22): who sent it is
    // the server's id, a named character must be theirs, and only short text fields are kept.
    // Every GM keeps its own copy of the access log (a state mirror, B1); saving it is a B4 item.
    socketManager.register(SOCKET_OPS.LOG_RELAY, (data, sender) => {
      if (!game.user.isGM) return;
      const accessLogService = game.nightcity?.accessLogService;
      const user = sender ? game.users?.get(sender) : null;
      if (!accessLogService || !user || !data || typeof data !== 'object') return;
      const s = (v, n) => String(v ?? '').slice(0, n);
      const actor = data.actorId && userOwnsActor(sender, data.actorId) ? game.actors.get(data.actorId) : null;
      log.debug('Socket: log relay received —', data.type, user.name);
      accessLogService._push({
        type: /^[\w-]{1,40}$/.test(data.type || '') ? data.type : 'note',
        networkId: s(data.networkId, 64), networkName: s(data.networkName, 80), message: s(data.message, 200),
        actorId: actor?.id || null, actorName: actor?.name || '', userId: sender, userName: user.name,
      });
    });

    // ─── Player Shard Conversion Relay ─────────────────────
    // Players can't create JournalEntries directly — the GM's client
    // receives the request, performs the conversion, and sends back the result.
    socketManager.register(SOCKET_OPS.SHARD_CONVERT_REQUEST, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)

      const { requestId, itemId, actorId, config } = data;
      // Entries a player encodes never carry a macro link — only the GM's tools set
      // one, and a linked macro runs on THIS (the GM's) client later (SEC-02).
      const entryData = data.entryData == null ? data.entryData : stripMacroRefs(data.entryData);
      log.info(`Socket: shard conversion request — item ${itemId} from actor ${actorId}`);

      let success = false;
      try {
        // Find the item on the actor
        const actor = game.actors.get(actorId);
        const item = actor?.items?.get(itemId);
        if (!item) throw new Error('Item not found');
        // Only the character's own player, and only when the world lets that character
        // write shards (the Encoder's gate, judged here too, audit SEC-05).
        if (!userOwnsActor(sender, actor)) throw new Error('the sender does not own that character');
        const gate = canEncode(actor, { user: game.users.get(sender) });
        if (!gate.ok) throw new Error(`${actor.name} may not write shards: ${gate.reason || 'player authoring is off'}`);
        if (data.reencode && !canEditShard(item, actor, { user: game.users.get(sender) }).ok) throw new Error(`${actor.name} may not rewrite "${item.name}"`);

        const service = game.nightcity?.dataShardService;
        if (!service) throw new Error('DataShardService not available');

        // A RE-ENCODE writes onto a shard that already exists: no conversion,
        // just the new quality on its player-made files plus any new ones.
        if (data.reencode) {
          const r = await service.reencodeShard(item, { ...(data.reencode || {}), entries: entryData || [] });
          success = !!r?.success;
          if (!success) log.warn('Shard re-encode failed:', r?.error);
          socketManager.emit(SOCKET_OPS.SHARD_CONVERT_RESULT, { requestId, success });
          return;
        }

        const result = await service.convertToDataShard(item, config || {});
        success = result.success;
        if (!result.success) {
          log.warn('Shard conversion failed:', result.error);
        } else if (entryData) {
          // Player can't write to the GM-owned shard journal — create the
          // entries here on the GM client (non-fatal if one fails). The Shard
          // Encoder can send SEVERAL: one chip, several forged files.
          for (const entry of (Array.isArray(entryData) ? entryData : [entryData])) {
            const entryResult = await service.addMessage(item, entry);
            if (!entryResult?.success) log.warn('Shard entry failed (non-fatal):', entryResult?.error);
          }
        }
      } catch (err) {
        log.error('Shard conversion relay failed:', err);
      }

      // Send result back
      socketManager.emit(SOCKET_OPS.SHARD_CONVERT_RESULT, { requestId, success });
    });

    // ─── Player Shard STATE Relay ─────────────────────────
    // A player who does not OWN a shard item (one that arrived as a message
    // attachment and lives in the world) cannot write its decrypted flag, their
    // session, or a per-entry decrypt — the GM lands it. One GM only.
    socketManager.register(SOCKET_OPS.SHARD_STATE_REQUEST, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)
      try {
        await game.nightcity?.dataShardService?.handleStateRequest(data, sender);
      } catch (err) {
        log.error('Shard state relay failed:', err);
      }
    });

    // ─── Player Shard INTEGRITY Relay ─────────────────────
    // A player's failed breach / reconstruct / repair / salvage writes the item's
    // integrity and the GM-owned shard journal — the GM lands it.
    socketManager.register(SOCKET_OPS.SHARD_INTEGRITY_REQUEST, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM lands it (INT-01)
      try {
        await game.nightcity?.dataShardService?.handleIntegrityRequest(data, sender);
      } catch (err) {
        log.error('Shard integrity relay failed:', err);
      }
    });

    // ─── Player Shard PRICE Relay (Shard Encoder, pricing 'propose') ───
    // system.price.market is on an item the player may not own, and the GM's
    // pricing mode is the authority — so the ask relays and the GM's own client
    // decides and writes. See scripts/ui/ShardEncoder/ShardMarket.js.
    socketManager.register(SOCKET_OPS.SHARD_PRICE_REQUEST, async (data) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)
      try {
        const { handleShardPriceRequest } = await import('../ui/ShardEncoder/ShardMarket.js');
        await handleShardPriceRequest(data);
      } catch (err) {
        log.error('Shard price relay failed:', err);
      }
    });

    // ─── Player Terminal Exfil Relay ─────────────────────
    // Players can't write the GM-owned terminal/inbox/shard journals, so the GM
    // client performs the copy and the result syncs back to the player.
    socketManager.register(SOCKET_OPS.TERMINAL_EXFIL_REQUEST, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)
      const { requestId, accountId, dest, targetActorId, frameIndex, aim } = data;
      const svc = game.nightcity?.terminalService;
      let result = { success: false, count: 0 };
      try {
        if (!svc) throw new Error('TerminalService not available');
        // The machine decides (audit SEC-06): the sender is in that account, the files are
        // its own, the entry's policy allows the action, the target is the sender's own.
        const ok = svc.checkExfilRequest(data, sender);
        if (!ok.ok) throw new Error(`refused: ${ok.why}`);
        const { item, ids } = ok;
        if (dest === 'saveFrame') {
          // SAVE FRAME (#37) — capture one feed channel into the player's Agent.
          result = await svc.exfilSaveFrame(item, accountId, ids[0], frameIndex, targetActorId, String(aim || '').slice(0, 80));
        } else if (dest === 'shard') {
          result = await svc.exfilToShard(item, accountId, ids, ok.target);
        } else if (dest === 'forward') {
          result = await svc.exfilForward(item, accountId, ids, targetActorId, ok.forwarder);
        } else if (dest === 'wipe') {
          result = await svc.exfilWipe(item, accountId, ids);
        } else {
          result = await svc.exfilToInbox(item, accountId, ids, targetActorId);
        }
      } catch (err) {
        log.warn('Terminal exfil relay:', err.message || err);
      }
      // The result goes back to whoever really sent it (A1), not the user the request names.
      socketManager.emit(SOCKET_OPS.TERMINAL_EXFIL_RESULT, { requestId, userId: sender, success: !!result.success, count: result.count || 0, dest });
    });

    // ─── Player Terminal Uplink Switch Relay ─────────────
    // The machine's uplink lives in item flags (terminalState.connection), which
    // players can't write on world items — the GM client performs the switch.
    // `authorized: true` = the player just passed the network's join challenge
    // client-side (the shard-relay trust model), so the machine remembers the
    // credential. No RESULT op: the flag write itself syncs to every client and
    // the viewer re-renders off the updateItem hook.
    socketManager.register(SOCKET_OPS.TERMINAL_NET_REQUEST, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)
      const { networkId, authorized } = data;
      const svc = game.nightcity?.terminalService;
      try {
        if (!svc) throw new Error('TerminalService not available');
        // Switching on, and a terminal the sender can reach (audit SEC-06).
        const ok = svc.checkUplinkRequest(data, sender);
        if (!ok.ok) throw new Error(`refused: ${ok.why}`);
        const item = ok.item;
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
    socketManager.register(SOCKET_OPS.TERMINAL_SESSION_REQUEST, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)
      const svc = game.nightcity?.terminalService;
      try {
        if (!svc) throw new Error('TerminalService not available');
        // The sender's own character, a terminal they can reach, session fields only (SEC-06).
        const ok = svc.checkSessionRequest(data, sender);
        if (!ok.ok) throw new Error(`refused: ${ok.why}`);
        await svc.applySessionUpdate(ok.item, data.actorId, ok.updates);
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
        shard: `Burned ${data.count} file(s) to ${withArticle(T('short', 'lower'))}.`,
        forward: `Forwarded ${data.count} file(s).`,
        wipe: `Wiped ${data.count} file(s) from the terminal.`,
        saveFrame: `Frame captured — check your ${folder} folder.`,
        inbox: `Downloaded ${data.count} file(s) to your Agent (${folder}).`,
      };
      if (data.success) ncmNotify.info(verb[data.dest] || verb.inbox);
      else ncmNotify.warn('Exfil failed — no GM available or the GM rejected it.');
    });

    // ─── Player Banking Siphon Relay (GM persists the drain / alerts) ──
    socketManager.register(SOCKET_OPS.BANK_SIPHON_REQUEST, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)
      try {
        const { handleSiphonRequest } = await import('../ui/content/SiphonFlow.js');
        await handleSiphonRequest(data, sender);
      } catch (err) {
        log.error('Bank siphon relay failed:', err);
      }
    });

    // ─── Player Typed-Content Update Relay (eddies claim / credential crack —
    //     the entry lives in a GM-owned journal, so the GM persists the write) ──
    socketManager.register(SOCKET_OPS.CONTENT_UPDATE_REQUEST, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)
      try {
        const { handleContentUpdateRequest } = await import('../ui/content/SiphonFlow.js');
        await handleContentUpdateRequest(data, sender);
      } catch (err) {
        log.error('Content update relay failed:', err);
      }
    });

    // ─── Player Payload Execution Relay (roll ran client-side; GM applies the
    //     module-native effect + payload state write on the GM-owned host) ──
    socketManager.register(SOCKET_OPS.PAYLOAD_EFFECT_REQUEST, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)
      try {
        const flow = await import('../ui/content/SiphonFlow.js');
        // Every kind (run, kill, malware effect, upload run) is checked against the sender (A3a).
        await flow.handlePayloadEffectRequest(data, sender);
      } catch (err) {
        log.error('Payload effect relay failed:', err);
      }
    });

    // ─── Player Upload/Plant Relay (FORGE roll ran client-side; GM installs the
    //     resident on the GM-owned terminalState) ──────────
    socketManager.register(SOCKET_OPS.TERMINAL_RESIDENT_REQUEST, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)
      try {
        const flow = await import('../ui/content/UploadFlow.js');
        await flow.handleResidentRequest(data, sender);
      } catch (err) {
        log.error('Resident install relay failed:', err);
      }
    });

    // ─── Player Trace Relay (a player tripped a trace; GM records the log + heat
    //     on the GM-owned world settings) ──────────────────
    socketManager.register(SOCKET_OPS.TRACE_REQUEST, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)
      try {
        await game.nightcity?.traceService?.handleTraceRequest(data, sender ?? null);
      } catch (err) {
        log.error('Trace relay failed:', err);
      }
    });

    // ─── Netrunning Tier C adjudication (design §5, hackResolution: 'gm') ───
    // A player's gated action does NOT auto-roll — the GM gets the NetAdjudicator
    // prompt and calls pass/fail; the verdict rides back to the waiting console.
    // CANCEL = the player withdrew while the GM was deciding (closes the prompt).
    socketManager.register(SOCKET_OPS.NET_RESOLVE_REQUEST, async (data, sender) => {
      if (!game.user.isGM) return;
      try {
        const nr = await import('../ui/content/NetResolve.js');
        await nr.handleNetResolveRequest(data, sender ?? null);
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

    socketManager.register(SOCKET_OPS.NET_RESOLVE_CANCEL, async (data, sender) => {
      if (!game.user.isGM) return;
      try {
        const nr = await import('../ui/content/NetResolve.js');
        nr.handleNetResolveCancel(data, sender ?? null);
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
    socketManager.register(SOCKET_OPS.SECURITY_LOCKOUT, (data, sender) => {
      if (!isFromGM(sender)) return;   // only a GM imposes a lockout (lockouts are saved now — audit D3)
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

    // ─── Players' tries reach the GM (player → GM) ────────
    // SecurityService state is client-local; a player's client reports its
    // attempt / lockout state on terminal-account keys so Admin → Terminals can
    // show "tried and missed" and an EARNED lockout. GM only stores it.
    socketManager.register(SOCKET_OPS.SECURITY_REPORT, (data, sender) => {
      if (!game.user.isGM) return;
      try {
        game.nightcity?.securityService?.receiveReport?.(data, sender);
      } catch (err) {
        log.error('Security report failed:', err);
      }
    });

    // ─── Force Refresh (GM → everyone): Admin → Tools ────
    socketManager.register(SOCKET_OPS.ADMIN_FORCE_REFRESH, (data, sender) => {
      if (!isFromGM(sender)) return;
      try {
        refreshNcmWindows();
        ncmNotify.info('NCM | Your GM refreshed Night City Messenger.');
      } catch (err) {
        log.error('Force refresh failed:', err);
      }
    });

    // ─── Clear tries / lockout (GM → everyone) ────────────
    socketManager.register(SOCKET_OPS.SECURITY_CLEAR, (data, sender) => {
      if (!isFromGM(sender)) return;   // a player "clearing" their own lockout would erase the saved one (audit D3)
      try {
        game.nightcity?.securityService?.receiveClear?.(data);
      } catch (err) {
        log.error('Security clear sync failed:', err);
      }
    });

    // ─── End a terminal session (GM → everyone) ───────────
    socketManager.register(SOCKET_OPS.TERMINAL_KICK, (data, sender) => {
      if (!isFromGM(sender)) return;   // only a GM ends someone's session
      try {
        game.nightcity?.securityService?.receiveKick?.(data);
      } catch (err) {
        log.error('Terminal kick failed:', err);
      }
    });

    // ─── Player Shard Unconvert Relay ────────────────────
    socketManager.register(SOCKET_OPS.SHARD_UNCONVERT_REQUEST, async (data, sender) => {
      if (!isPrimaryGM()) return;   // one GM handles each request (INT-01)

      const { requestId, itemId, actorId } = data;
      log.info(`Socket: shard unconvert request — item ${itemId} from actor ${actorId}`);

      let success = false;
      try {
        const actor = game.actors.get(actorId);
        const item = actor?.items?.get(itemId);
        if (!item) throw new Error('Item not found');
        // The same door the player's menu checks: their own character, allowed to author shards (SEC-05).
        if (!userOwnsActor(sender, actor)) throw new Error('the sender does not own that character');
        if (!canEncode(actor, { user: game.users.get(sender) }).ok) throw new Error(`${actor.name} may not remove shard data`);

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
