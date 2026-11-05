/**
 * Contact Share Service — Sprint 3.4
 * @file scripts/services/ContactShareService.js
 * @module night-city-messenger
 * @description Business logic for sharing contacts between players.
 *   Handles the full pipeline: data preparation → socket relay (sender → GM → recipients)
 *   → contact storage → Data Drop overlay → toast notification.
 *
 *   Flow:
 *     1. Sender opens ContactShareDialog, picks recipients + options
 *     2. Dialog calls shareService.initiateShare()
 *     3. Service prepares contact data via PortraitService.prepareForShare()
 *     4. If sender is GM: delivers directly to each recipient
 *        If sender is player: sends CONTACT_SHARE_RELAY to GM via socket
 *     5. GM receives relay, calls _deliverToRecipients() for each target
 *     6. Each recipient: writes contact to their ContactRepository,
 *        plays DataDropOverlay, fires contact-acquired toast
 *     7. EventBus emits CONTACT_SHARED on completion
 */

import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { isSelectableCharacter, log } from '../utils/helpers.js';
import { normaliseNumber } from '../utils/phoneNumbering.js';

export class ContactShareService {

  // ═══════════════════════════════════════════════════════════
  //  Service Accessors
  // ═══════════════════════════════════════════════════════════

  get contactRepo() { return game.nightcity?.contactRepository; }
  get portraitService() { return game.nightcity?.portraitService; }
  get notificationService() { return game.nightcity?.notificationService; }
  get socketManager() { return game.nightcity?.socketManager; }
  get eventBus() { return game.nightcity?.eventBus; }
  get networkService() { return game.nightcity?.networkService; }

  // ═══════════════════════════════════════════════════════════
  //  Public API — Sender Side
  // ═══════════════════════════════════════════════════════════

  /**
   * Initiate a contact share from sender to one or more recipients.
   * Called by ContactShareDialog when the user clicks "Data Drop".
   *
   * @param {object} params
   * @param {string} params.senderActorId — Actor ID of the sender
   * @param {string} params.contactId — ID of the contact being shared
   * @param {string[]} params.recipientActorIds — Array of recipient actor IDs
   * @param {object} [params.options] — Share options
   * @param {boolean} [params.options.includePortrait=true]
   * @param {boolean} [params.options.includeNotes=false]
   * @param {boolean} [params.options.includeTags=true]
   * @param {'both'|'email'|'number'} [params.options.send='both'] which of the two the recipient gets
   * @returns {Promise<{success: boolean, delivered?: number, errors?: string[]}>}
   */
  async initiateShare(params) {
    const {
      senderActorId,
      contactId,
      recipientActorIds = [],
      options = {},
    } = params;

    // ── Validation ──
    if (!senderActorId || !contactId || recipientActorIds.length === 0) {
      return { success: false, errors: ['Missing required parameters.'] };
    }

    // ── Load source contact ──
    const contacts = await this.contactRepo.getContacts(senderActorId);
    const sourceContact = contacts.find(c => c.id === contactId);
    if (!sourceContact) {
      return { success: false, errors: ['Contact not found.'] };
    }

    // ── Prepare contact data for sharing ──
    const preparedContact = await this._prepareShareData(sourceContact, options);

    // ── Resolve sender info ──
    const senderActor = game.actors.get(senderActorId);
    const senderName = senderActor?.name || 'Unknown';
    const currentNetwork = this.networkService?.currentNetworkId || 'CITINET';

    // ── Build share payload ──
    const payload = {
      shareId: foundry.utils.randomID(),
      senderActorId,
      senderUserId: game.user.id,
      senderName,
      // The GM rebuilds the shared copy from these (audit SEC-07): which of the
      // sender's contacts, and what of it they chose to send.
      sourceContactId: contactId,
      options: { includePortrait: options.includePortrait !== false, includeNotes: !!options.includeNotes, includeTags: options.includeTags !== false, send: options.send || 'both' },
      contact: preparedContact,
      recipientActorIds,
      network: currentNetwork,
      timestamp: Date.now(),
    };

    // ── Route through GM relay or deliver directly ──
    if (game.user.isGM) {
      // GM can deliver directly
      return this._deliverToRecipients(payload);
    } else {
      // Player sends via socket to GM
      return this._relayViaSocket(payload);
    }
  }

  /**
   * Get eligible share recipients — player-owned actors except the sender.
   *
   * For players, the list is restricted to characters who are present in the
   * current scene **or** already in the sender's contacts (a Data Drop reaches
   * someone you're physically near or have a comm channel to). The GM is not
   * restricted and sees every player-owned actor.
   *
   * @param {string} senderActorId — Exclude this actor
   * @returns {Promise<Array<{actorId: string, name: string, img: string, email: string, ownerName: string}>>}
   */
  async getEligibleRecipients(senderActorId) {
    const recipients = [];

    for (const actor of game.actors) {
      // Skip the sender, and anything that isn't a character on offer
      if (actor.id === senderActorId || !isSelectableCharacter(actor)) continue;

      // Only actors with player ownership (not just observer)
      const owners = Object.entries(actor.ownership || {})
        .filter(([userId, level]) => level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER && userId !== 'default');

      if (owners.length === 0) continue;

      // Get the first owner's name for display
      const ownerUser = game.users.get(owners[0][0]);
      const ownerName = ownerUser?.name || '';

      // Get email from contact repo or generate from name
      const email = this.contactRepo?.getActorEmail(actor.id)
        || `${actor.name.toLowerCase().replace(/\s+/g, '.')}@nightcity.net`;

      recipients.push({
        actorId: actor.id,
        name: actor.name,
        img: actor.img,
        email,
        ownerName,
      });
    }

    recipients.sort((a, b) => a.name.localeCompare(b.name));

    // GM bypasses the scene/contacts restriction.
    if (game.user.isGM) return recipients;

    // Players: keep only recipients in the current scene OR in their contacts.
    const sceneActorIds = this._getSceneActorIds();
    const senderContacts = (await this.contactRepo?.getContacts(senderActorId)) || [];
    const contactEmails = new Set(
      senderContacts.map(c => (c.email || '').toLowerCase().trim()).filter(Boolean)
    );

    return recipients.filter(r =>
      sceneActorIds.has(r.actorId)
      || contactEmails.has((r.email || '').toLowerCase().trim())
    );
  }

  /**
   * Actor IDs that have a token on the scene the current user is viewing.
   * @returns {Set<string>}
   */
  _getSceneActorIds() {
    const ids = new Set();
    const scene = canvas?.scene || game.scenes?.active;
    if (!scene) return ids;
    for (const token of scene.tokens) {
      if (token.actorId) ids.add(token.actorId);
      if (token.actor?.id) ids.add(token.actor.id);
    }
    return ids;
  }

  // ═══════════════════════════════════════════════════════════
  //  Delivery Pipeline — GM Side
  // ═══════════════════════════════════════════════════════════

  /**
   * Deliver a shared contact to all recipients.
   * Called by GM directly or via socket relay handler.
   *
   * @param {object} payload — Share payload from initiateShare()
   * @returns {Promise<{success: boolean, delivered: number, errors: string[]}>}
   */
  async _deliverToRecipients(payload) {
    const { recipientActorIds, contact, senderName, network, shareId } = payload;
    const errors = [];
    let delivered = 0;

    for (const recipientActorId of recipientActorIds) {
      try {
        // Write contact to recipient's address book. Someone who has this contact gets the missing part added.
        const result = await this._mergeExisting(recipientActorId, contact) || await this.contactRepo.addContact(recipientActorId, contact);

        if (result.success) {
          delivered++;

          // Notify the recipient's client via socket
          this.socketManager?.emit(SOCKET_OPS.CONTACT_SHARE_NOTIFY, {
            shareId,
            recipientActorId,
            senderUserId: payload.senderUserId,
            senderName,
            contact,
            network,
          });

          log.info(`Contact "${contact.name}" shared to ${recipientActorId}`);
        } else {
          errors.push(`Failed to add contact to ${recipientActorId}: ${result.error}`);
        }
      } catch (error) {
        log.error(`ContactShareService._deliverToRecipients: ${error.message}`);
        errors.push(`Error delivering to ${recipientActorId}: ${error.message}`);
      }
    }

    // Emit event for sender-side feedback
    const displayName = contact.encrypted ? 'ICE-Protected Contact' : contact.name;
    this.eventBus?.emit(EVENTS.CONTACT_SHARED, {
      shareId: payload.shareId,
      contactName: displayName,
      delivered,
      total: recipientActorIds.length,
    });

    return { success: delivered > 0, delivered, errors };
  }

  /**
   * Re-sharing adds what they lack: a number to an email they had, or the reverse. Nothing they have is overwritten.
   * @returns {Promise<{success: boolean}|null>} null when they don't have this contact yet
   */
  async _mergeExisting(actorId, contact) {
    const actor = game.actors?.get(actorId);
    const list = await this.contactRepo.getContacts(actorId);
    if (!actor || !Array.isArray(list)) return null;
    const home = game.nightcity?.callService?.homeCode;
    const num = (n) => normaliseNumber(n, home);
    const mail = (m) => String(m || '').trim().toLowerCase();
    const same = (c) => (contact.masterContactId && c.masterContactId === contact.masterContactId)
      || (contact.email && mail(c.email) === mail(contact.email))
      || (contact.phone && c.phone && num(c.phone) === num(contact.phone));
    const had = list.find(same);
    if (!had) return null;
    const patch = {};
    if (contact.email && !had.email) patch.email = contact.email;
    if (contact.phone && !had.phone) patch.phone = contact.phone;
    if (Object.keys(patch).length) await actor.setFlag(MODULE_ID, 'contacts', list.map((c) => (c === had ? { ...c, ...patch } : c)));
    return { success: true, merged: true };
  }

  /**
   * Handle incoming share relay from a player (GM-side handler).
   * Registered as a socket handler in SocketHandlers.
   *
   * @param {object} payload — Share payload from player
   */
  async handleShareRelay(payload, senderId = null) {
    if (!game.user.isGM) return;
    // two GMs online would each deliver it
    if (game.users?.activeGM && game.users.activeGM.id !== game.user.id) return;

    log.debug('ContactShareService: Processing share relay', payload?.shareId);
    const checked = await this.checkShareRelay(payload, senderId);
    if (!checked.ok) { log.warn(`Contact share refused: ${checked.why}`); return; }
    payload = checked.payload;
    const result = await this._deliverToRecipients(payload);

    // Send confirmation back to sender
    this.socketManager?.emit(SOCKET_OPS.CONTACT_SHARE_CONFIRM, {
      shareId: payload.shareId,
      senderActorId: payload.senderActorId,
      delivered: result.delivered,
      total: payload.recipientActorIds.length,
      errors: result.errors,
    });
  }

  /**
   * GM side: rebuild a relayed share from the sender's own address book (audit SEC-07).
   * The sending character must be the player's own; the contact must be one of that
   * character's contacts, and the copy sent is prepared here from it, with the options
   * the player chose; recipients are other players' selectable characters. Sender name
   * and user come from what the GM knows, never from the request.
   * @returns {Promise<{ok:true, payload:object}|{ok:false, why:string}>}
   */
  async checkShareRelay(payload, senderId) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const user = senderId ? game.users?.get(senderId) : null;
    if (!user) return { ok: false, why: 'unknown sender' };
    const owns = (id) => {
      const a = id ? game.actors?.get(id) : null;
      return !!a && (user.isGM || !!a.testUserPermission?.(user, globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3));
    };
    if (!owns(p.senderActorId)) return { ok: false, why: `${user.name} can only share from their own character` };
    const contacts = (await this.contactRepo?.getContacts(p.senderActorId)) || [];
    const source = contacts.find((c) => c.id === p.sourceContactId);
    if (!source) return { ok: false, why: 'that contact is not in the sender\'s address book' };
    const o = p.options && typeof p.options === 'object' ? p.options : {};
    const contact = await this._prepareShareData(source, { includePortrait: o.includePortrait !== false, includeNotes: !!o.includeNotes, includeTags: o.includeTags !== false, send: ['email', 'number', 'both'].includes(o.send) ? o.send : 'both' });
    const recipientActorIds = [...new Set((Array.isArray(p.recipientActorIds) ? p.recipientActorIds : []).map(String))]
      .filter((id) => id !== p.senderActorId && isSelectableCharacter(game.actors?.get(id)))
      .slice(0, 50);
    if (!recipientActorIds.length) return { ok: false, why: 'no one to share with' };
    return {
      ok: true,
      payload: {
        shareId: String(p.shareId || foundry.utils.randomID()).slice(0, 40),
        senderActorId: p.senderActorId,
        senderUserId: senderId,
        senderName: game.actors.get(p.senderActorId)?.name || user.name,
        contact,
        recipientActorIds,
        network: typeof p.network === 'string' ? p.network.slice(0, 60) : 'CITINET',
        timestamp: Date.now(),
      },
    };
  }

  /**
   * One animation per drop on any screen. The sender already played theirs, a GM owns every actor but is not receiving
   * anything, and a share to several characters notifies once per character.
   */
  _wantsShareFx({ shareId, senderUserId }) {
    if (game.user.isGM || senderUserId === game.user.id) return false;
    this._sharesSeen ??= new Set();
    if (shareId && this._sharesSeen.has(shareId)) return false;
    if (shareId) this._sharesSeen.add(shareId);
    return true;
  }

  /**
   * Handle incoming share notification (recipient-side handler).
   * Plays the Data Drop overlay and fires the toast.
   *
   * @param {object} data — { shareId, recipientActorId, senderName, contact, network }
   */
  async handleShareNotification(data) {
    const { recipientActorId, senderName, contact, network } = data;

    // Only process if we own this actor
    const actor = game.actors.get(recipientActorId);
    if (!actor?.isOwner) return;

    // Redact name/portrait for encrypted contacts
    const displayName = contact.encrypted ? 'ICE-Protected Contact' : contact.name;
    const displayContact = contact.encrypted
      ? { ...contact, name: displayName, portrait: '', customImg: '' }
      : contact;

    log.info(`Received shared contact: "${displayName}" from ${senderName}`);

    // Play the Data Drop overlay animation
    if (this._wantsShareFx(data)) {
      try {
        const { DataDropOverlay } = await import('../ui/DataDropOverlay/DataDropOverlay.js');
        await DataDropOverlay.play({
          senderName,
          recipientName: actor.name,
          contact: displayContact,
          network,
        });
      } catch (error) {
        log.warn('DataDropOverlay failed, showing toast only:', error.message);
      }
    }

    // Fire the contact-acquired toast: for the player receiving it, not the GM or the one who sent it
    if (!game.user.isGM && data.senderUserId !== game.user.id) {
      this.notificationService?.showContactAcquired({
        contactName: displayName,
        senderName,
        network,
        actorId: recipientActorId,
        contactId: contact.id,
      });
    }

    // Emit event for UI refresh
    this.eventBus?.emit(EVENTS.CONTACT_SHARED, {
      contactName: displayName,
      senderName,
      recipientActorId,
    });
  }

  /**
   * Handle share confirmation from GM (sender-side handler).
   * Fires when the GM has finished delivering to all recipients.
   *
   * @param {object} data — { shareId, senderActorId, delivered, total, errors }
   */
  handleShareConfirmation(data) {
    const { senderActorId, delivered, total, errors } = data;

    // Only process if we own the sender actor
    const actor = game.actors.get(senderActorId);
    if (!actor?.isOwner) return;

    if (delivered === total) {
      this.notificationService?.showToast(
        'Data Drop Complete',
        `Contact shared to ${delivered} recipient${delivered !== 1 ? 's' : ''}.`,
        'success',
        4000
      );
    } else if (delivered > 0) {
      this.notificationService?.showToast(
        'Partial Delivery',
        `Shared to ${delivered}/${total}. ${errors.length} error(s).`,
        'warning',
        6000
      );
    } else {
      this.notificationService?.showToast(
        'Data Drop Failed',
        errors[0] || 'All deliveries failed.',
        'error',
        6000
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Internal Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Prepare contact data for sharing. Strips sensitive data,
   * optionally includes portrait/notes/tags, converts portrait to base64.
   *
   * @param {object} contact — Source contact data
   * @param {object} options — { includePortrait, includeNotes, includeTags }
   * @returns {Promise<object>} Prepared contact ready for transfer
   */
  async _prepareShareData(contact, options = {}) {
    const {
      includePortrait = true,
      includeNotes = false,
      includeTags = true,
      send = 'both',
    } = options;

    // Use PortraitService for data preparation
    const prepared = this.portraitService
      ? this.portraitService.prepareForShare(contact, { includePortrait, includeNotes, includeTags })
      : { ...contact, id: foundry.utils.randomID() };

    // Email, number or both. Only what is sent exists on their copy.
    if (send === 'email') prepared.phone = '';
    if (send === 'number') { prepared.email = ''; delete prepared.actorId; delete prepared.linkedActorId; }

    // If including portrait, ensure it's base64 for cross-client transfer
    if (includePortrait && prepared.portrait && this.portraitService) {
      prepared.portrait = await this.portraitService.ensureBase64(prepared.portrait);
    }

    return prepared;
  }

  /**
   * Send share payload to GM via socket relay.
   *
   * @param {object} payload — Share payload
   * @returns {Promise<{success: boolean, errors?: string[]}>}
   */
  async _relayViaSocket(payload) {
    if (!this.socketManager) {
      return { success: false, errors: ['SocketManager not available.'] };
    }

    try {
      this.socketManager.emit(SOCKET_OPS.CONTACT_SHARE_RELAY, payload);
      // Actual delivery confirmation comes async via CONTACT_SHARE_CONFIRM
      return { success: true, delivered: 0, errors: [] };
    } catch (error) {
      log.error('ContactShareService._relayViaSocket:', error);
      return { success: false, errors: [error.message] };
    }
  }
}
