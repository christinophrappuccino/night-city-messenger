/**
 * Contact Share Service — Sprint 3.4
 * @file scripts/services/ContactShareService.js
 * @module cyberpunkred-messenger
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
import { log } from '../utils/helpers.js';

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
      senderName,
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
   * Get eligible share recipients — all player-owned actors except the sender.
   *
   * @param {string} senderActorId — Exclude this actor
   * @returns {Array<{actorId: string, name: string, img: string, email: string, ownerName: string}>}
   */
  getEligibleRecipients(senderActorId) {
    const recipients = [];

    for (const actor of game.actors) {
      // Skip the sender
      if (actor.id === senderActorId) continue;

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

    // Sort alphabetically by name
    return recipients.sort((a, b) => a.name.localeCompare(b.name));
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
        // Write contact to recipient's address book
        const result = await this.contactRepo.addContact(recipientActorId, contact);

        if (result.success) {
          delivered++;

          // Notify the recipient's client via socket
          this.socketManager?.emit(SOCKET_OPS.CONTACT_SHARE_NOTIFY, {
            shareId,
            recipientActorId,
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
    this.eventBus?.emit(EVENTS.CONTACT_SHARED, {
      shareId: payload.shareId,
      contactName: contact.name,
      delivered,
      total: recipientActorIds.length,
    });

    return { success: delivered > 0, delivered, errors };
  }

  /**
   * Handle incoming share relay from a player (GM-side handler).
   * Registered as a socket handler in SocketHandlers.
   *
   * @param {object} payload — Share payload from player
   */
  async handleShareRelay(payload) {
    if (!game.user.isGM) return;

    log.debug('ContactShareService: Processing share relay', payload.shareId);
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

    log.info(`Received shared contact: "${contact.name}" from ${senderName}`);

    // Play the Data Drop overlay animation
    try {
      const { DataDropOverlay } = await import('../ui/DataDropOverlay/DataDropOverlay.js');
      await DataDropOverlay.play({
        senderName,
        recipientName: actor.name,
        contact,
        network,
      });
    } catch (error) {
      log.warn('DataDropOverlay failed, showing toast only:', error.message);
    }

    // Fire the contact-acquired toast
    this.notificationService?.showContactAcquired({
      contactName: contact.name,
      senderName,
      network,
      actorId: recipientActorId,
      contactId: contact.id,
    });

    // Emit event for UI refresh
    this.eventBus?.emit(EVENTS.CONTACT_SHARED, {
      contactName: contact.name,
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
    } = options;

    // Use PortraitService for data preparation
    const prepared = this.portraitService
      ? this.portraitService.prepareForShare(contact, { includePortrait, includeNotes, includeTags })
      : { ...contact, id: foundry.utils.randomID() };

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
