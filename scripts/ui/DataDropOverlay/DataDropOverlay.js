/**
 * Data Drop Overlay v2 — Sprint 3.8 Redesign
 * @file scripts/ui/DataDropOverlay/DataDropOverlay.js
 * @module cyberpunkred-messenger
 * @description Full-screen animated overlay that plays the Data Drop transmission
 *   sequence. Full-screen backdrop with grid + scanline, floating panel with
 *   header, route dot visualization, phase text, progress bar, and contact card
 *   materialization with typing reveal.
 *
 *   Plays on both sender and recipient screens when a contact is shared.
 *   Auto-dismisses after the animation completes (~4.5s).
 *
 *   Usage:
 *     await DataDropOverlay.play({
 *       senderName: 'V',
 *       recipientName: 'Jackie',
 *       contact: { name, email, role, tags, portrait, encrypted },
 *       network: 'CITINET',
 *       isSender: false,
 *     });
 *
 *   Animation phases (~4.5s total):
 *     Phase 1 (0–1400ms):    Route dots light up L→R, connections fill
 *     Phase 2 (400–2000ms):  Phase text + progress bar
 *     Phase 3 (2000–3100ms): Card materializes (avatar → name → email → badges/ICE note)
 *     Phase 4 (3400–4500ms): Status flash + fadeout
 */

import { MODULE_ID, TEMPLATES } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';
import {
  getAvatarColor,
  getInitials,
} from '../../utils/designHelpers.js';

/** Phase timing (ms from start) */
const T = {
  NODE_0_ACTIVE:  200,
  NODE_0_DONE:    600,
  NODE_1_ACTIVE:  600,
  NODE_1_DONE:    1000,
  NODE_2_ACTIVE:  1000,
  NODE_2_DONE:    1400,
  PHASE_0:        600,
  PHASE_1:        1000,
  PHASE_2:        1400,
  PHASES_DONE:    2000,
  PROGRESS_START: 400,
  PROGRESS_DUR:   1600,
  CARD_APPEAR:    2000,
  CARD_NAME:      2400,
  CARD_EMAIL:     2800,
  CARD_BADGES:    3100,
  STATUS:         3400,
  FADEOUT:        4500,
};

export class DataDropOverlay {

  /**
   * Play the Data Drop animation. Returns a promise that resolves when complete.
   *
   * @param {object} params
   * @param {string} params.senderName
   * @param {string} params.recipientName
   * @param {object} params.contact
   * @param {string} [params.network='CITINET']
   * @param {boolean} [params.isSender=false]
   * @returns {Promise<void>}
   */
  static async play(params) {
    const {
      senderName = 'Unknown',
      recipientName = 'Unknown',
      contact = {},
      network = 'CITINET',
      isSender = false,
    } = params;

    // Check animation level
    const animLevel = document.body.dataset?.ncmAnimationLevel;
    if (animLevel === 'off') {
      log.debug('DataDropOverlay: Animations off, skipping');
      return;
    }

    // Prepare template data — redact if encrypted
    const isEncrypted = !!contact.encrypted;
    const contactName = isEncrypted ? 'ICE-Protected Contact' : (contact.name || 'Unknown');
    const contactEmail = isEncrypted ? '███@███.██' : (contact.email || '');
    const portrait = isEncrypted ? null : (contact.portrait || null);
    const avatarColor = isEncrypted ? '#555570' : getAvatarColor(contact.name || 'Unknown');
    const initials = isEncrypted ? '?' : getInitials(contact.name || 'Unknown');
    const relayName = `${network} RELAY`;

    const tags = isEncrypted ? [] : (contact.tags || []).slice(0, 3);
    const role = isEncrypted ? '' : (contact.role?.toUpperCase() || '');

    const templateData = {
      senderName,
      recipientName,
      relayName,
      network,
      contactName,
      contactEmail,
      portrait,
      avatarColor,
      initials,
      role,
      tags,
      isSender,
      isEncrypted,
      statusText: isSender ? 'CONTACT TRANSMITTED' : 'CONTACT ACQUIRED',
    };

    // Render the overlay
    let overlayEl;
    try {
      const html = await renderTemplate(TEMPLATES.DATA_DROP_OVERLAY, templateData);
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html.trim();
      overlayEl = wrapper.firstElementChild;
    } catch (error) {
      log.warn('DataDropOverlay: Template render failed, using fallback');
      overlayEl = DataDropOverlay._buildFallback(templateData);
    }

    if (!overlayEl) return;

    // Reduced animations: show everything at once
    if (animLevel === 'reduced') {
      return DataDropOverlay._playReduced(overlayEl);
    }

    // Full animation
    return DataDropOverlay._playFull(overlayEl);
  }

  /**
   * Full animation sequence (~4.5s).
   * @param {HTMLElement} el — The overlay root element
   * @returns {Promise<void>}
   */
  static _playFull(el) {
    return new Promise((resolve) => {
      document.body.appendChild(el);
      void el.offsetHeight;
      el.classList.add('ncm-datadrop--active');

      const nodes = el.querySelectorAll('.ncm-datadrop__node');
      const conns = el.querySelectorAll('.ncm-datadrop__conn');
      const phases = el.querySelectorAll('.ncm-datadrop__phase');

      // ── Phase 1: Route dots ──
      setTimeout(() => nodes[0]?.classList.add('ncm-datadrop__node--active'), T.NODE_0_ACTIVE);

      setTimeout(() => {
        nodes[0]?.classList.replace('ncm-datadrop__node--active', 'ncm-datadrop__node--done');
        conns[0]?.classList.add('ncm-datadrop__conn--active');
        nodes[1]?.classList.add('ncm-datadrop__node--active');
        phases[0]?.classList.add('ncm-datadrop__phase--active');
      }, T.NODE_0_DONE);

      setTimeout(() => {
        nodes[1]?.classList.replace('ncm-datadrop__node--active', 'ncm-datadrop__node--done');
        conns[1]?.classList.add('ncm-datadrop__conn--active');
        nodes[2]?.classList.add('ncm-datadrop__node--active');
        phases[0]?.classList.replace('ncm-datadrop__phase--active', 'ncm-datadrop__phase--done');
        phases[1]?.classList.add('ncm-datadrop__phase--active');
      }, T.NODE_1_DONE);

      setTimeout(() => {
        nodes[2]?.classList.replace('ncm-datadrop__node--active', 'ncm-datadrop__node--done');
        phases[1]?.classList.replace('ncm-datadrop__phase--active', 'ncm-datadrop__phase--done');
        phases[2]?.classList.add('ncm-datadrop__phase--active');
      }, T.NODE_2_DONE);

      // All phases done
      setTimeout(() => {
        phases[2]?.classList.replace('ncm-datadrop__phase--active', 'ncm-datadrop__phase--done');
      }, T.PHASES_DONE);

      // ── Phase 2: Progress bar ──
      const progressFill = el.querySelector('.ncm-datadrop__progress-fill');
      if (progressFill) {
        setTimeout(() => {
          progressFill.style.transition = `width ${T.PROGRESS_DUR}ms ease`;
          progressFill.style.width = '100%';
        }, T.PROGRESS_START);
      }

      // ── Phase 3: Card materialization ──
      const card = el.querySelector('.ncm-datadrop__card');
      setTimeout(() => card?.classList.add('ncm-datadrop__card--visible'), T.CARD_APPEAR);

      const cardName = el.querySelector('.ncm-datadrop__card-name');
      setTimeout(() => cardName?.classList.add('ncm-datadrop__card-name--reveal'), T.CARD_NAME);

      const cardEmail = el.querySelector('.ncm-datadrop__card-email');
      setTimeout(() => cardEmail?.classList.add('ncm-datadrop__card-email--visible'), T.CARD_EMAIL);

      const cardBadges = el.querySelector('.ncm-datadrop__card-badges');
      const iceNote = el.querySelector('.ncm-datadrop__card-ice-note');
      setTimeout(() => {
        cardBadges?.classList.add('ncm-datadrop__card-badges--visible');
        iceNote?.classList.add('ncm-datadrop__card-ice-note--visible');
      }, T.CARD_BADGES);

      // ── Phase 4: Status ──
      const status = el.querySelector('.ncm-datadrop__status');
      setTimeout(() => status?.classList.add('ncm-datadrop__status--visible'), T.STATUS);

      // ── Fadeout + cleanup ──
      setTimeout(() => {
        el.classList.add('ncm-datadrop--exiting');
        setTimeout(() => { el.remove(); resolve(); }, 350);
      }, T.FADEOUT);
    });
  }

  /**
   * Reduced animation: show everything at once with a simple fade in/out.
   * @param {HTMLElement} el
   * @returns {Promise<void>}
   */
  static _playReduced(el) {
    return new Promise((resolve) => {
      // Pre-activate everything
      el.querySelectorAll('.ncm-datadrop__node').forEach(n => n.classList.add('ncm-datadrop__node--done'));
      el.querySelectorAll('.ncm-datadrop__conn').forEach(c => c.classList.add('ncm-datadrop__conn--active'));
      el.querySelectorAll('.ncm-datadrop__phase').forEach(p => p.classList.add('ncm-datadrop__phase--done'));

      const fill = el.querySelector('.ncm-datadrop__progress-fill');
      if (fill) fill.style.width = '100%';

      const card = el.querySelector('.ncm-datadrop__card');
      if (card) card.classList.add('ncm-datadrop__card--visible');

      const name = el.querySelector('.ncm-datadrop__card-name');
      if (name) { name.classList.add('ncm-datadrop__card-name--reveal'); name.style.width = '100%'; }

      const email = el.querySelector('.ncm-datadrop__card-email');
      if (email) email.classList.add('ncm-datadrop__card-email--visible');

      const badges = el.querySelector('.ncm-datadrop__card-badges');
      if (badges) badges.classList.add('ncm-datadrop__card-badges--visible');

      const iceNote = el.querySelector('.ncm-datadrop__card-ice-note');
      if (iceNote) iceNote.classList.add('ncm-datadrop__card-ice-note--visible');

      const status = el.querySelector('.ncm-datadrop__status');
      if (status) status.classList.add('ncm-datadrop__status--visible');

      document.body.appendChild(el);
      void el.offsetHeight;
      el.classList.add('ncm-datadrop--active');

      // Hold then fade
      setTimeout(() => {
        el.classList.add('ncm-datadrop--exiting');
        setTimeout(() => { el.remove(); resolve(); }, 350);
      }, 2000);
    });
  }

  /**
   * Fallback: build overlay DOM manually if template unavailable.
   * @param {object} data
   * @returns {HTMLElement}
   */
  static _buildFallback(data) {
    const el = document.createElement('div');
    el.classList.add('ncm-datadrop');

    const avatarContent = data.isEncrypted
      ? '<i class="fas fa-lock" style="font-size:20px;color:#F0C55B;"></i>'
      : data.portrait ? `<img src="${data.portrait}" alt="${data.contactName}">` : data.initials;

    const avatarClass = data.isEncrypted ? 'ncm-datadrop__card-avatar ncm-datadrop__card-avatar--ice' : 'ncm-datadrop__card-avatar';

    el.innerHTML = `
      <div class="ncm-datadrop__backdrop"></div>
      <div class="ncm-datadrop__scanline"></div>
      <div class="ncm-datadrop__grid"></div>
      <div class="ncm-datadrop__panel">
        <div class="ncm-datadrop__header">
          <div class="ncm-datadrop__header-icon"><i class="fas fa-share-nodes"></i></div>
          <div class="ncm-datadrop__header-text">
            <div class="ncm-datadrop__header-title">Data Drop</div>
            <div class="ncm-datadrop__header-sub">${data.network || 'CITINET'} // ${data.isSender ? 'TRANSMITTING CONTACT' : 'RECEIVING CONTACT'}</div>
          </div>
        </div>
        <div class="ncm-datadrop__route">
          <div class="ncm-datadrop__node"><div class="ncm-datadrop__node-dot"></div><div class="ncm-datadrop__node-label">${data.senderName}</div></div>
          <div class="ncm-datadrop__conn"><div class="ncm-datadrop__conn-fill"></div></div>
          <div class="ncm-datadrop__node"><div class="ncm-datadrop__node-dot"></div><div class="ncm-datadrop__node-label">${data.relayName}</div></div>
          <div class="ncm-datadrop__conn"><div class="ncm-datadrop__conn-fill"></div></div>
          <div class="ncm-datadrop__node"><div class="ncm-datadrop__node-dot"></div><div class="ncm-datadrop__node-label">${data.recipientName}</div></div>
        </div>
        <div class="ncm-datadrop__phases">
          <div class="ncm-datadrop__phase"><div class="ncm-datadrop__phase-dot"></div> Establishing connection</div>
          <div class="ncm-datadrop__phase"><div class="ncm-datadrop__phase-dot"></div> Authenticating sender</div>
          <div class="ncm-datadrop__phase"><div class="ncm-datadrop__phase-dot"></div> Transmitting contact data</div>
        </div>
        <div class="ncm-datadrop__progress"><div class="ncm-datadrop__progress-fill" style="width:0%;"></div></div>
        <div class="ncm-datadrop__card">
          <div class="${avatarClass}" style="color:${data.avatarColor};">${avatarContent}</div>
          <div class="ncm-datadrop__card-info">
            <div class="ncm-datadrop__card-name">${data.contactName}</div>
            <div class="ncm-datadrop__card-email">${data.contactEmail}</div>
            <div class="ncm-datadrop__card-badges">
              ${data.role ? `<span class="ncm-datadrop__badge">${data.role}</span>` : ''}
              ${data.tags.map(t => `<span class="ncm-datadrop__badge">${t}</span>`).join('')}
            </div>
            ${data.isEncrypted ? '<div class="ncm-datadrop__card-ice-note"><i class="fas fa-shield-halved"></i> ICE encryption active — breach required</div>' : ''}
          </div>
        </div>
        <div class="ncm-datadrop__status"><i class="fas fa-circle-check"></i> ${data.statusText}</div>
      </div>
    `;

    return el;
  }
}
