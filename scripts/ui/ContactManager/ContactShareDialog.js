/**
 * Contact Share Dialog — Sprint 3.4
 * @file scripts/ui/ContactManager/ContactShareDialog.js
 * @module cyberpunkred-messenger
 * @description Player-facing dialog for sharing a contact with other players.
 *   Shows the contact being shared, a recipient selector (multi-select),
 *   option toggles (portrait/notes/tags), and a "Data Drop" send button.
 *
 *   Triggered from the share icon on a contact card in ContactManagerApp.
 *   On submit, calls ContactShareService.initiateShare() and plays
 *   the Data Drop overlay animation on the sender side.
 *
 *   Extends BaseApplication for consistent lifecycle, theming, and cleanup.
 */

import { MODULE_ID, TEMPLATES } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import {
  getAvatarColor,
  getInitials,
} from '../../utils/designHelpers.js';

export class ContactShareDialog extends BaseApplication {

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  /** @type {string} Actor ID of the sender */
  senderActorId = null;

  /** @type {object} Contact being shared */
  contact = null;

  /** @type {Set<string>} Selected recipient actor IDs */
  selectedRecipients = new Set();

  /** @type {object} Share options */
  shareOptions = {
    includePortrait: true,
    includeNotes: false,
    includeTags: true,
  };

  /** @type {boolean} Whether a share operation is in progress */
  _sending = false;

  // ═══════════════════════════════════════════════════════════
  //  Service Accessors
  // ═══════════════════════════════════════════════════════════

  get shareService() { return game.nightcity?.contactShareService; }
  get portraitService() { return game.nightcity?.portraitService; }

  // ═══════════════════════════════════════════════════════════
  //  ApplicationV2 Configuration
  // ═══════════════════════════════════════════════════════════

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-contact-share-dialog',
    classes: ['ncm-app', 'ncm-contact-share-dialog'],
    window: {
      title: 'Share Contact — Data Drop',
      icon: 'fas fa-share-nodes',
      resizable: false,
      minimizable: false,
    },
    position: {
      width: 380,
      height: 'auto',
    },
    actions: {
      toggleRecipient:  ContactShareDialog._onToggleRecipient,
      toggleOption:     ContactShareDialog._onToggleOption,
      sendDataDrop:     ContactShareDialog._onSendDataDrop,
      cancelShare:      ContactShareDialog._onCancelShare,
    },
  }, { inplace: false });

  static PARTS = {
    main: {
      template: TEMPLATES.CONTACT_SHARE_DIALOG,
    },
  };

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  constructor(options = {}) {
    super(options);
    this.senderActorId = options.senderActorId || null;
    this.contact = options.contact || null;
  }

  // ═══════════════════════════════════════════════════════════
  //  Data Preparation
  // ═══════════════════════════════════════════════════════════

  async _prepareContext(options) {
    if (!this.contact || !this.senderActorId) {
      return { hasData: false };
    }

    // ── Contact preview ──
    const portrait = this.portraitService?.resolvePortrait(this.contact) || null;
    const avatarColor = getAvatarColor(this.contact.name);
    const initials = getInitials(this.contact.name);
    const contactMeta = [
      this.contact.email,
      this.contact.role?.toUpperCase(),
      this.contact.organization,
    ].filter(Boolean).join(' · ');

    // ── Eligible recipients ──
    const allRecipients = this.shareService?.getEligibleRecipients(this.senderActorId) || [];
    const recipients = allRecipients.map(r => {
      const rPortrait = r.img && r.img !== 'icons/svg/mystery-man.svg' ? r.img : null;
      return {
        ...r,
        portrait: rPortrait,
        initials: getInitials(r.name),
        avatarColor: getAvatarColor(r.name),
        selected: this.selectedRecipients.has(r.actorId),
      };
    });

    const hasRecipients = recipients.length > 0;
    const canSend = hasRecipients && this.selectedRecipients.size > 0 && !this._sending;

    return {
      hasData: true,
      contact: this.contact,
      portrait,
      avatarColor,
      initials,
      contactMeta,
      recipients,
      hasRecipients,
      canSend,
      sending: this._sending,
      selectedCount: this.selectedRecipients.size,
      options: this.shareOptions,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers
  // ═══════════════════════════════════════════════════════════

  /**
   * Toggle a recipient selection on/off.
   */
  static _onToggleRecipient(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;

    if (this.selectedRecipients.has(actorId)) {
      this.selectedRecipients.delete(actorId);
    } else {
      this.selectedRecipients.add(actorId);
    }

    this.render();
  }

  /**
   * Toggle a share option (portrait/notes/tags).
   */
  static _onToggleOption(event, target) {
    const option = target.closest('[data-option]')?.dataset.option;
    if (!option || !(option in this.shareOptions)) return;

    this.shareOptions[option] = !this.shareOptions[option];
    this.render();
  }

  /**
   * Execute the Data Drop — share contact to all selected recipients.
   */
  static async _onSendDataDrop(event, target) {
    if (this._sending) return;
    if (this.selectedRecipients.size === 0) {
      ui.notifications.warn('Select at least one recipient.');
      return;
    }

    this._sending = true;
    this.render();

    try {
      // Play sender-side Data Drop overlay
      const recipientActorIds = [...this.selectedRecipients];
      const firstRecipient = game.actors.get(recipientActorIds[0]);

      try {
        const { DataDropOverlay } = await import('../DataDropOverlay/DataDropOverlay.js');
        await DataDropOverlay.play({
          senderName: game.actors.get(this.senderActorId)?.name || 'Unknown',
          recipientName: firstRecipient?.name || 'Recipient',
          contact: this.contact,
          network: game.nightcity?.networkService?.currentNetworkId || 'CITINET',
          isSender: true,
        });
      } catch (err) {
        log.warn('DataDropOverlay failed on sender side:', err.message);
      }

      // Execute share via service
      const result = await this.shareService.initiateShare({
        senderActorId: this.senderActorId,
        contactId: this.contact.id,
        recipientActorIds,
        options: { ...this.shareOptions },
      });

      if (result.success) {
        // GM gets instant confirmation; players get async via socket
        if (game.user.isGM) {
          game.nightcity?.notificationService?.showToast(
            'Data Drop Complete',
            `"${this.contact.name}" shared to ${result.delivered} recipient${result.delivered !== 1 ? 's' : ''}.`,
            'success',
            4000
          );
        }
        this.close();
      } else {
        ui.notifications.error(result.errors?.[0] || 'Data Drop failed.');
        this._sending = false;
        this.render();
      }
    } catch (error) {
      log.error('ContactShareDialog._onSendDataDrop:', error);
      ui.notifications.error('Data Drop failed unexpectedly.');
      this._sending = false;
      this.render();
    }
  }

  /**
   * Cancel and close the dialog.
   */
  static _onCancelShare(event, target) {
    this.close();
  }
}
