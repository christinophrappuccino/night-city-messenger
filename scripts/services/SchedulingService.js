/**
 * SchedulingService
 * @file scripts/services/SchedulingService.js
 * @module night-city-messenger
 * @description Scheduled message delivery with TimeService + SimpleCalendar integration.
 *              Queue scheduled messages, check on time-tick, deliver via MessageService
 *              when due. Stores schedule data in world settings.
 *              Supports both real-time and in-game-time scheduling.
 */

import { ncmNotify } from '../utils/notify.js';
import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { log, isGM, resolveDisplayName, whisperCardHtml } from '../utils/helpers.js';

/**
 * Everyone a scheduled message goes to, as recipient rows. Several people or a group ride in `recipients` (toActorId is then
 * an array or empty and `to` is blank), which is why reading only those two fields showed "Unknown" (tester 2026-11-02).
 * @param {object} d - the entry's messageData
 * @returns {Array<{actorId: string|null, contactId: string|null, email: string, name: string}>}
 */
export function scheduledRecipients(d = {}) {
  if (Array.isArray(d.recipients) && d.recipients.length) return d.recipients;
  const actorIds = Array.isArray(d.toActorId) ? d.toActorId : [d.toActorId].filter(Boolean);
  if (actorIds.length > 1) return actorIds.map((actorId) => ({ actorId, contactId: null, email: '', name: '' }));
  if (!actorIds.length && !d.toContactId && !d.to) return [];
  return [{ actorId: actorIds[0] || null, contactId: d.toContactId || null, email: d.to || '', name: d.toName || '' }];
}

/** Who a scheduled message goes to, for a list row: a name, a few names, or the first names and a count. */
export function scheduledRecipientLabel(d = {}) {
  const names = scheduledRecipients(d).map((r) => r.name
    || resolveDisplayName({ contactId: r.contactId, actorId: r.actorId, email: r.email }, r.email || ''));
  const known = names.filter(Boolean);
  if (known.length > 3) return `${known.slice(0, 2).join(', ')} +${known.length - 2}`;
  if (known.length) return known.join(', ');
  if (d.groupId) return game.nightcity?.contactGroupService?.findGroup?.(d.groupId, { actorId: d.fromActorId })?.name || 'A group';
  if (d.anonReply) return d.anonReply.alias || 'Unknown';
  return 'Unknown';
}

/**
 * What the composer needs to reopen a scheduled message as it was. Eddies come back only when the entry records that they were
 * really paid (`eddiesHeld`), because cancelling refunds exactly that and sending charges them again. A macro's scheduled eddies
 * were never paid, and an entry saved before refunds existed can't be told apart from one: `eddiesNotRestored` says so.
 * @param {object} entry - a scheduled entry
 * @param {{isGM?: boolean}} [o]
 */
export function scheduledComposerState(entry = {}, { isGM: gm = false } = {}) {
  const d = entry.messageData || {};
  const enc = d.encryption || null;
  const sd = d.selfDestruct || null;
  const anon = (gm && d.anonymous?.enabled) ? d.anonymous : null;
  const held = Number(entry.eddiesHeld) || 0;
  const eddies = Number(d.eddies) || 0;
  return {
    threadId: d.threadId || null,
    inReplyTo: d.inReplyTo || null,
    attachments: (d.attachments || []).filter((a) => !a?.isEddies),
    eddiesAmount: held > 0 ? eddies : 0,
    eddiesNotRestored: held > 0 ? 0 : eddies,
    encryption: enc ? {
      type: enc.type, dv: enc.dc, failureMode: enc.failureMode || 'nothing', maxAttempts: enc.maxAttempts || 0,
      bypassSkills: enc.bypassSkills || null, iceSource: enc.ice?.source || 'default', iceActorId: enc.ice?.actorId || null,
    } : null,
    selfDestructMode: sd?.mode || null,
    anonymous: anon ? { style: anon.style, alias: anon.alias || '', allowReplies: anon.allowReplies !== false, traceDV: anon.traceDV } : null,
    anonReply: d.anonReply || null,
    sendNetworkId: (gm && d.networkOverride && d.network) || null,
    scheduledTime: entry.deliveryTime || '',
    scheduleGameTime: entry.useGameTime !== false,
  };
}

/** A timed self-destruct's clock starts when the mail arrives, not when it was scheduled. */
export function selfDestructAtDelivery(selfDestruct, nowMs) {
  if (!selfDestruct?.duration || !Number.isFinite(nowMs)) return selfDestruct;
  return { ...selfDestruct, expiresAt: new Date(nowMs + selfDestruct.duration).toISOString() };
}

/**
 * For the one-time migration: messages scheduled before payments were recorded. The composer debited eddies × recipients, and
 * only from a character, so that is what they held. An entry that already has a figure is left alone.
 * @param {Array<object>} list
 * @returns {{list: Array<object>, changed: number}}
 */
export function creditOldScheduled(list = []) {
  let changed = 0;
  const out = list.map((e) => {
    const d = e?.messageData || {};
    if (e?.eddiesHeld !== undefined || !(Number(d.eddies) > 0) || !d.fromActorId) return e;
    const count = Math.max(1, Array.isArray(d.recipients) ? d.recipients.length : (Array.isArray(d.toActorId) ? d.toActorId.length : 1));
    changed++;
    return { ...e, eddiesHeld: Number(d.eddies) * count };
  });
  return { list: out, changed };
}

export class SchedulingService {

  /** @type {Array<object>} In-memory cache of scheduled messages */
  _scheduled = [];

  /** @type {number|null} Interval ID for periodic check */
  _checkInterval = null;

  /** Check interval in ms (every 10 seconds) */
  static CHECK_INTERVAL_MS = 10_000;

  // ─── Service Accessors (lazy getters — no constructor injection) ──

  get settingsManager() { return game.nightcity?.settingsManager; }
  get messageService() { return game.nightcity?.messageService; }
  get timeService() { return game.nightcity?.timeService; }
  get eventBus() { return game.nightcity?.eventBus; }
  get socketManager() { return game.nightcity?.socketManager; }

  // ═══════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Initialize the scheduling service.
   * Loads persisted scheduled messages and starts the check loop.
   * Only the GM client processes deliveries.
   */
  initialize() {
    this._loadScheduled();
    this._startCheckLoop();
    this._registerSocketHandlers();
    this._registerSettingSync();
    this._registerSimpleCalendarHook();
    log.info(`SchedulingService initialized — ${this._scheduled.length} scheduled messages loaded`);
  }

  /**
   * Clean up on module teardown.
   */
  destroy() {
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
      this._checkInterval = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  /**
   * Schedule a message for future delivery.
   * @param {object} messageData - Standard message data (toActorId, fromActorId, subject, body, etc.)
   * @param {string} deliveryTime - ISO-8601 timestamp for delivery (game time)
   * @param {object} [options]
   * @param {boolean} [options.useGameTime=true] - Compare against game time (vs real time)
   * @param {number} [options.eddiesHeld=0] - Eddies already taken from the sender for this message, refunded if it is cancelled
   * @returns {{ success: boolean, scheduleId?: string, error?: string }}
   */
  async scheduleMessage(messageData, deliveryTime, options = {}) {
    try {
      // Accept every sender and recipient an immediate send accepts (tester 2026-10-29: a GM paying a player FROM an
      // NPC directory contact sent fine at once and failed the moment it was scheduled — the old check wanted two actors).
      const hasSender = !!(messageData.fromActorId || messageData.fromContactId || messageData.from);
      const hasRecipient = !!(messageData.toActorId || messageData.toContactId || messageData.to
        || (Array.isArray(messageData.recipients) && messageData.recipients.length) || messageData.groupId || messageData.anonReply);
      if (!hasSender || !hasRecipient) {
        return { success: false, error: 'Sender and recipient are required' };
      }
      // 2. the schedule lives in a world setting only the GM can write, and only the GM delivers it — a player's
      // scheduled message is handed to the GM's client, which saves it. No GM online = it would be lost, so say so.
      if (!isGM() && !game.users?.activeGM) {
        return { success: false, error: 'A GM must be online to schedule a message — send it now, or try again when the GM is on.' };
      }

      if (!deliveryTime) {
        return { success: false, error: 'Delivery time is required' };
      }

      const useGameTime = options.useGameTime !== false;

      // Validate delivery time is in the future
      const now = useGameTime
        ? this.timeService?.getCurrentTime() ?? new Date().toISOString()
        : new Date().toISOString();

      if (new Date(deliveryTime) <= new Date(now)) {
        return { success: false, error: 'Delivery time must be in the future' };
      }

      const scheduleId = foundry.utils.randomID();
      const entry = {
        scheduleId,
        messageData: { ...messageData },
        deliveryTime,
        useGameTime,
        eddiesHeld: Number(options.eddiesHeld) || 0,
        createdAt: new Date().toISOString(),
        createdBy: game.user.id,
        status: 'pending', // pending, delivered, cancelled
      };

      this._scheduled.push(entry);
      if (isGM()) await this._persistScheduled();

      // Sync to other clients
      this.socketManager?.emit(SOCKET_OPS.SCHEDULE_SYNC, {
        action: 'add',
        entry,
      });

      this.eventBus?.emit(EVENTS.MESSAGE_SCHEDULED, {
        scheduleId,
        deliveryTime,
        fromActorId: messageData.fromActorId,
        toActorId: messageData.toActorId,
      });

      log.info(`Message scheduled: ${scheduleId} for delivery at ${deliveryTime}`);
      return { success: true, scheduleId };
    } catch (error) {
      console.error(`${MODULE_ID} | SchedulingService.scheduleMessage:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cancel a scheduled message and give back any eddies taken for it.
   * @param {string} scheduleId
   * @returns {{ success: boolean, refunded?: number, error?: string }}
   */
  async cancelScheduled(scheduleId) {
    try {
      // Only the GM's save makes a cancel stick. Without one the message would come back on reload, already refunded.
      if (!isGM() && !game.users?.activeGM) {
        return { success: false, error: 'A GM must be online to change a scheduled message.' };
      }
      const idx = this._scheduled.findIndex(e => e.scheduleId === scheduleId);
      if (idx === -1) {
        return { success: false, error: 'Scheduled message not found' };
      }

      const entry = this._scheduled[idx];
      if (entry.status !== 'pending') {
        return { success: false, error: `Cannot cancel — status is '${entry.status}'` };
      }

      entry.status = 'cancelled';
      this._scheduled.splice(idx, 1);
      if (isGM()) await this._persistScheduled();

      this.socketManager?.emit(SOCKET_OPS.SCHEDULE_SYNC, {
        action: 'cancel',
        scheduleId,
      });

      log.info(`Scheduled message cancelled: ${scheduleId}`);
      return { success: true, refunded: await this._refund(entry, entry.eddiesHeld, 'scheduled message cancelled') };
    } catch (error) {
      console.error(`${MODULE_ID} | SchedulingService.cancelScheduled:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Put a scheduled message's eddies back on its sender's sheet. Whoever triggers it writes: the sender's player owns the actor,
   * and a GM can write any. A failure is said out loud, because the money would otherwise just vanish.
   * @param {object} entry
   * @param {number} amount
   * @param {string} reason - for the ledger
   * @returns {Promise<number>} the amount refunded
   * @private
   */
  async _refund(entry, amount, reason) {
    amount = Number(amount) || 0;
    if (amount <= 0) return 0;
    const actor = game.actors?.get?.(entry.messageData?.fromActorId);
    const failed = () => {
      ncmNotify.error(`NCM | Could not refund ${amount.toLocaleString()} eb (${reason}). Add it back to the sender's sheet by hand.`, { permanent: true });
      return 0;
    };
    if (!actor?.system?.wealth || !(actor.isOwner || isGM())) return failed();
    try {
      const wealth = foundry.utils.deepClone(actor.system.wealth);
      wealth.value += amount;
      wealth.transactions.push([`Increased by ${amount} to ${wealth.value}`, `NCM: Refund of ${amount.toLocaleString()} eb, ${reason}`]);
      await actor.update({ 'system.wealth': wealth });
      return amount;
    } catch (error) {
      console.error(`${MODULE_ID} | SchedulingService._refund:`, error);
      return failed();
    }
  }

  /**
   * Edit a pending scheduled message.
   * @param {string} scheduleId
   * @param {object} updates - Partial updates to messageData or deliveryTime
   * @returns {{ success: boolean, error?: string }}
   */
  async editScheduled(scheduleId, updates) {
    try {
      const entry = this._scheduled.find(e => e.scheduleId === scheduleId);
      if (!entry) {
        return { success: false, error: 'Scheduled message not found' };
      }
      if (entry.status !== 'pending') {
        return { success: false, error: `Cannot edit — status is '${entry.status}'` };
      }

      if (updates.deliveryTime) {
        entry.deliveryTime = updates.deliveryTime;
      }
      if (updates.messageData) {
        foundry.utils.mergeObject(entry.messageData, updates.messageData);
      }

      if (isGM()) await this._persistScheduled();

      this.socketManager?.emit(SOCKET_OPS.SCHEDULE_SYNC, {
        action: 'edit',
        scheduleId,
        updates,
      });

      log.info(`Scheduled message updated: ${scheduleId}`);
      return { success: true };
    } catch (error) {
      console.error(`${MODULE_ID} | SchedulingService.editScheduled:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all pending scheduled messages.
   * @returns {Array<object>}
   */
  getPending() {
    return this._scheduled.filter(e => e.status === 'pending');
  }

  /**
   * Get all scheduled messages (including delivered/cancelled for admin view).
   * @returns {Array<object>}
   */
  getAll() {
    return [...this._scheduled];
  }

  /**
   * Get a specific scheduled message by ID.
   * @param {string} scheduleId
   * @returns {object|null}
   */
  getScheduled(scheduleId) {
    return this._scheduled.find(e => e.scheduleId === scheduleId) ?? null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL — Check Loop & Delivery
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start the periodic check loop. Only the GM delivers.
   * @private
   */
  _startCheckLoop() {
    if (this._checkInterval) clearInterval(this._checkInterval);

    this._checkInterval = setInterval(() => {
      this._checkAndDeliver();
    }, SchedulingService.CHECK_INTERVAL_MS);
  }

  /**
   * Check all pending messages and deliver those that are due.
   * Only the GM client performs actual delivery.
   * @private
   */
  /** The ONE client that delivers and saves: the active GM (two GMs online used to deliver everything twice). */
  _isDeliverer() {
    if (!isGM()) return false;
    const active = game.users?.activeGM;
    return !active || active.id === game.user.id;
  }

  async _checkAndDeliver() {
    if (!this._isDeliverer()) return; // only the active GM delivers
    if (this._delivering) return;      // the interval and a world-time hook can overlap
    this._delivering = true;
    try { await this._checkAndDeliverInner(); } finally { this._delivering = false; }
  }

  async _checkAndDeliverInner() {

    const pending = this.getPending();
    if (pending.length === 0) return;

    let delivered = 0;
    let settled = 0;

    for (const entry of pending) {
      const now = entry.useGameTime
        ? this.timeService?.getCurrentTime() ?? new Date().toISOString()
        : new Date().toISOString();

      if (new Date(entry.deliveryTime) <= new Date(now)) {
        const result = await this._deliverScheduled(entry);
        if (result.success) delivered++;
        if (result.success || result.refused) settled++;
      }
    }

    if (settled > 0) await this._persistScheduled();
    if (delivered > 0) {
      log.info(`Delivered ${delivered} scheduled message(s)`);
    }
  }

  /**
   * Deliver a single scheduled message via MessageService.
   * @param {object} entry
   * A send that comes back refused is finished: it leaves the schedule, its eddies go back and it is listed in Outbox →
   * Didn't arrive, where Retry can resend it. It used to stay pending and retry every 10 seconds, indefinitely and silently.
   * Only an exception thrown here stays pending.
   * @returns {{ success: boolean, refused?: boolean, error?: string }}
   * @private
   */
  async _deliverScheduled(entry) {
    try {
      const msgData = {
        ...entry.messageData,
        metadata: {
          ...(entry.messageData.metadata || {}),
          scheduledDelivery: entry.deliveryTime,
          scheduleId: entry.scheduleId,
        },
      };

      const clock = entry.useGameTime ? new Date(this.timeService?.getCurrentTime?.() ?? Date.now()).getTime() : Date.now();
      if (msgData.selfDestruct) msgData.selfDestruct = selfDestructAtDelivery(msgData.selfDestruct, clock);

      // Remove the scheduled status flag
      if (msgData.status) {
        msgData.status.scheduled = false;
      }

      const toLabel = scheduledRecipientLabel(entry.messageData);
      const perCopy = Number(entry.messageData?.eddies) || 0;
      const result = await this.messageService?.sendMessage(msgData);
      if (!result) return { success: false };

      if (result.success) {
        entry.status = 'delivered';
        entry.deliveredAt = new Date().toISOString();
        log.info(`Scheduled message delivered: ${entry.scheduleId}`);
        // Some of a group refused: MessageService has listed them; give back their share.
        const share = Math.min(perCopy * (result.failed?.length || 0), Number(entry.eddiesHeld) || 0);
        const refunded = await this._refund(entry, share, 'scheduled message not delivered to everyone');
        if (result.failed?.length) await this._tellRefused(entry, toLabel, result.failed.map((x) => `${x.name || x.email || '?'}: ${x.error || 'unknown error'}`).join(' · '), refunded);
        return { success: true };
      }

      log.warn(`Scheduled delivery refused for ${entry.scheduleId}: ${result.error}`);
      entry.status = 'failed';
      entry.failedAt = new Date().toISOString();
      // A fan-out has already listed itself in _sendToMany; a single recipient has not.
      if (!result.failed?.length) {
        const d = entry.messageData || {};
        await this.messageService?.recordDeliveryFailure?.({
          data: { ...msgData, toName: toLabel, fromName: d.fromName || resolveDisplayName({ contactId: d.fromContactId, actorId: d.fromActorId, email: d.from }, d.from || 'Unknown') },
          result, source: 'scheduled',
        });
      }
      const refunded = await this._refund(entry, entry.eddiesHeld, 'scheduled message could not be delivered');
      await this._tellRefused(entry, toLabel, result.error || 'unknown error', refunded);
      return { success: false, refused: true, error: result.error };
    } catch (error) {
      console.error(`${MODULE_ID} | SchedulingService._deliverScheduled:`, error);
      return { success: false };
    }
  }

  /** Tell the GM (and the player who scheduled it) that a scheduled message did not get through. Never throws. */
  async _tellRefused(entry, toLabel, why, refunded) {
    try {
      const paid = refunded ? ` ${refunded.toLocaleString()} eb refunded.` : '';
      ncmNotify.warn(`NCM | Scheduled message to ${toLabel} not delivered: ${why}.${paid} See Messages → Outbox.`, { permanent: true });
      const by = game.users?.get?.(entry.createdBy);
      if (!by || by.isGM || typeof ChatMessage === 'undefined') return;
      const reason = this.messageService?.constructor?.playerFacingError?.(why) || why;
      await ChatMessage.create({
        whisper: [by.id],
        content: whisperCardHtml({
          tone: 'warn', icon: 'fa-clock', title: 'Scheduled message not delivered',
          lines: [`"${entry.messageData?.subject || '(no subject)'}" to ${toLabel}.`, reason, ...(refunded ? [`${refunded.toLocaleString()} eb refunded.`] : [])],
        }),
      });
    } catch (error) {
      console.warn(`${MODULE_ID} | could not report a refused scheduled message:`, error);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL — Persistence
  // ═══════════════════════════════════════════════════════════════

  /**
   * Load scheduled messages from world settings.
   * @private
   */
  _loadScheduled() {
    try {
      const stored = this.settingsManager?.get('scheduledMessages') ?? [];
      // Only keep pending entries (clean up old delivered/cancelled)
      this._scheduled = stored.filter(e => e.status === 'pending');
    } catch (error) {
      log.warn('Failed to load scheduled messages — starting fresh');
      this._scheduled = [];
    }
  }

  /**
   * Persist scheduled messages to world settings.
   * Only stores pending entries.
   * @private
   */
  async _persistScheduled() {
    try {
      const toStore = this._scheduled.filter(e => e.status === 'pending');
      await this.settingsManager?.set('scheduledMessages', toStore);
    } catch (error) {
      console.error(`${MODULE_ID} | SchedulingService._persistScheduled:`, error);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL — Socket & Calendar Hooks
  // ═══════════════════════════════════════════════════════════════

  /**
   * Register socket handler for schedule sync across clients.
   * @private
   */
  _registerSocketHandlers() {
    this.socketManager?.register(SOCKET_OPS.SCHEDULE_SYNC, async (data, sender) => {
      // The saved list (a world setting) is what every client reads. Only the GM who saves it acts on a
      // sync, after checking who sent it (audit SEC-07); every other client follows the setting
      // (_registerSettingSync). Before this, any client could add, cancel or rewrite anyone's mail here.
      if (!this._isDeliverer()) return;
      const user = sender ? game.users?.get(sender) : null;
      if (!user || !data) return;
      if (data.action === 'add' && data.entry) {
        const ok = await this.checkScheduledAdd(data.entry, user);
        if (!ok.ok) { log.warn(`Scheduled message refused: ${ok.why}`); return; }
        // Avoid duplicate from own emit
        if (!this._scheduled.find(e => e.scheduleId === ok.entry.scheduleId)) this._scheduled.push(ok.entry);
      } else if (data.action === 'cancel' && data.scheduleId) {
        const entry = this._scheduled.find(e => e.scheduleId === data.scheduleId);
        if (!entry) return;
        if (!user.isGM && entry.createdBy !== user.id) { log.warn(`Scheduled message cancel refused: ${user.name} did not schedule it`); return; }
        this._scheduled = this._scheduled.filter(e => e.scheduleId !== data.scheduleId);
      } else if (data.action === 'edit' && data.scheduleId && data.updates) {
        // Only the GM's Outbox edits a scheduled message in place; a player's Edit cancels and schedules again.
        if (!user.isGM) { log.warn(`Scheduled message edit refused: ${user.name} is not a GM`); return; }
        const entry = this._scheduled.find(e => e.scheduleId === data.scheduleId);
        if (entry) {
          if (data.updates.deliveryTime) entry.deliveryTime = data.updates.deliveryTime;
          if (data.updates.messageData) {
            foundry.utils.mergeObject(entry.messageData, data.updates.messageData);
          }
        }
      } else return;
      // A player cannot write the world setting: the active GM saves the change for them (before this, a player's
      // scheduled message lived only in the GM's memory and was lost on a reload).
      this._persistScheduled();
    });
  }

  /**
   * GM side: may this user schedule this message? (audit SEC-07) A GM may schedule anything.
   * A player's entry gets the same checks as their live mail (MessageService.checkRelaySender:
   * their own character or one of its identities, or a terminal account they are in; GM-only
   * options dropped; the sending fields rebuilt), and its eddies must have been taken: the
   * entry's `eddiesHeld` covers every recipient and the sender's ledger shows that charge.
   * @returns {Promise<{ok:true, entry:object}|{ok:false, why:string}>}
   */
  async checkScheduledAdd(entry, user) {
    if (user.isGM) return { ok: true, entry };
    const md = entry?.messageData && typeof entry.messageData === 'object' ? { ...entry.messageData } : null;
    if (!md) return { ok: false, why: 'no message' };
    const ms = game.nightcity?.messageService;
    if (!ms?.checkRelaySender) return { ok: false, why: 'mail service unavailable' };
    const per = Math.max(0, Number(md.eddies) || 0);
    // checkRelaySender rebuilds the sending fields on the object it is given (eddies are checked
    // below against eddiesHeld, so it sees none).
    const check = { ...md, eddies: 0 };
    const who = await ms.checkRelaySender(check, user.id);
    if (!who.ok) return who;
    const rebuilt = { ...check, eddies: md.eddies };
    let held = Math.max(0, Number(entry.eddiesHeld) || 0);
    if (per > 0) {
      const count = Math.max(1, Array.isArray(md.recipients) ? md.recipients.length : 1);
      const payer = game.actors?.get(rebuilt.fromActorId);
      if (held < per * count || !payer || !(await ms.verifyEddiesPaid(payer, per, count))) {
        return { ok: false, why: `the ${per.toLocaleString()} eb attached were never taken from the sender` };
      }
    } else held = 0;
    return { ok: true, entry: { ...entry, messageData: rebuilt, eddiesHeld: held, createdBy: user.id, status: 'pending' } };
  }

  /**
   * Keep every other client's list in step with the saved one. Without this a player's list still showed a message after it
   * was delivered, and cancelling it there would refund eddies already sent.
   * @private
   */
  _registerSettingSync() {
    Hooks.on('updateSetting', (setting) => {
      if (setting?.key === `${MODULE_ID}.scheduledMessages` && !this._isDeliverer()) this._loadScheduled();
    });
  }

  /**
   * Hook into SimpleCalendar time changes for game-time–based scheduling.
   * @private
   */
  _registerSimpleCalendarHook() {
    // SimpleCalendar emits a hook when time changes
    if (typeof SimpleCalendar !== 'undefined') {
      Hooks.on('simple-calendar-date-time-change', () => {
        this._checkAndDeliver();
      });
      log.debug('SchedulingService: SimpleCalendar time-change hook registered');
    }

    // Also listen for Foundry world time updates (fallback)
    Hooks.on('updateWorldTime', () => {
      this._checkAndDeliver();
    });
  }
}
