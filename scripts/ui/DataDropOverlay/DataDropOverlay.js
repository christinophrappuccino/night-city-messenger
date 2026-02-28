/**
 * Data Drop Overlay — Sprint 3.8
 * @file scripts/ui/DataDropOverlay/DataDropOverlay.js
 * @module cyberpunkred-messenger
 * @description Full-screen animated overlay that plays the Data Drop transmission
 *   sequence. Shows route visualization (sender → relay → recipient), phase text
 *   progression, progress bar, and contact card materialization with typing reveal.
 *
 *   Plays on both sender and recipient screens when a contact is shared.
 *   Auto-dismisses after the animation completes (~3.5s).
 *
 *   Usage:
 *     await DataDropOverlay.play({
 *       senderName: 'V',
 *       recipientName: 'Jackie',
 *       contact: { name, email, role, tags, portrait },
 *       network: 'CITINET',
 *       isSender: false,  // true = sender sees "TRANSMITTING", false = receiver sees "RECEIVING"
 *     });
 *
 *   Animation phases (~3.5s total):
 *     Phase 1 (0-800ms):   Route nodes light up left-to-right
 *     Phase 2 (800-1600ms): Phase text progresses, progress bar fills
 *     Phase 3 (1600-2800ms): Contact card materializes (avatar → name typing → email → badges)
 *     Phase 4 (2800-3500ms): "CONTACT ACQUIRED" success flash, then fadeout
 */

import { MODULE_ID, TEMPLATES } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';
import {
  getAvatarColor,
  getInitials,
} from '../../utils/designHelpers.js';

/** Total animation duration in ms */
const TOTAL_DURATION = 3800;

/** Phase timing (ms from start) */
const PHASE_TIMING = {
  ROUTE_START:     0,
  ROUTE_NODE_1:    200,
  ROUTE_NODE_2:    500,
  ROUTE_NODE_3:    800,
  PHASE_TEXT_1:    300,
  PHASE_TEXT_2:    700,
  PHASE_TEXT_3:    1100,
  PROGRESS_START:  300,
  PROGRESS_END:    1600,
  CARD_APPEAR:     1600,
  CARD_NAME:       1900,
  CARD_EMAIL:      2200,
  CARD_BADGES:     2500,
  STATUS_SUCCESS:  2800,
  FADEOUT:         3500,
};

export class DataDropOverlay {

  /**
   * Play the Data Drop animation. Returns a promise that resolves when complete.
   *
   * @param {object} params
   * @param {string} params.senderName — Sender display name
   * @param {string} params.recipientName — Recipient display name
   * @param {object} params.contact — Contact data being shared
   * @param {string} [params.network='CITINET'] — Current network name
   * @param {boolean} [params.isSender=false] — Whether this is the sender's screen
   * @returns {Promise<void>} Resolves when animation completes
   */
  static async play(params) {
    const {
      senderName = 'Unknown',
      recipientName = 'Unknown',
      contact = {},
      network = 'CITINET',
      isSender = false,
    } = params;

    // Check animation level — skip if animations are off
    const animLevel = document.body.dataset?.ncmAnimationLevel;
    if (animLevel === 'off') {
      log.debug('DataDropOverlay: Animations off, skipping overlay');
      return;
    }

    // Prepare template data
    const portrait = contact.portrait || null;
    const avatarColor = getAvatarColor(contact.name || 'Unknown');
    const initials = getInitials(contact.name || 'Unknown');
    const relayName = `${network} RELAY`;

    const tags = (contact.tags || []).slice(0, 3);
    const role = contact.role?.toUpperCase() || '';

    const templateData = {
      senderName,
      recipientName,
      relayName,
      contactName: contact.name || 'Unknown',
      contactEmail: contact.email || '',
      portrait,
      avatarColor,
      initials,
      role,
      tags,
      isSender,
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

    // Reduced animations: show card immediately without phase-by-phase reveal
    if (animLevel === 'reduced') {
      return DataDropOverlay._playReduced(overlayEl, templateData);
    }

    // Full animation
    return DataDropOverlay._playFull(overlayEl);
  }

  /**
   * Full animation sequence (~3.8s).
   * @param {HTMLElement} overlayEl
   * @returns {Promise<void>}
   */
  static _playFull(overlayEl) {
    return new Promise((resolve) => {
      document.body.appendChild(overlayEl);

      // Force reflow
      void overlayEl.offsetHeight;
      overlayEl.classList.add('ncm-datadrop--active');

      // ── Phase 1: Route nodes ──
      const nodes = overlayEl.querySelectorAll('.ncm-datadrop__node');
      const hops = overlayEl.querySelectorAll('.ncm-datadrop__hop');

      nodes.forEach((node, i) => {
        const timing = [PHASE_TIMING.ROUTE_NODE_1, PHASE_TIMING.ROUTE_NODE_2, PHASE_TIMING.ROUTE_NODE_3][i];
        setTimeout(() => {
          node.classList.add('ncm-datadrop__node--active');
          // Mark previous nodes as done
          for (let j = 0; j < i; j++) {
            nodes[j].classList.remove('ncm-datadrop__node--active');
            nodes[j].classList.add('ncm-datadrop__node--done');
          }
        }, timing);
      });

      // Light up hops progressively
      hops.forEach((hop, i) => {
        const timing = [PHASE_TIMING.ROUTE_NODE_1 + 150, PHASE_TIMING.ROUTE_NODE_2 + 150][i];
        if (timing) {
          setTimeout(() => hop.classList.add('ncm-datadrop__hop--active'), timing);
        }
      });

      // Mark final node as done
      setTimeout(() => {
        nodes.forEach(n => {
          n.classList.remove('ncm-datadrop__node--active');
          n.classList.add('ncm-datadrop__node--done');
        });
        hops.forEach(h => h.classList.add('ncm-datadrop__hop--active'));
      }, PHASE_TIMING.ROUTE_NODE_3 + 200);

      // ── Phase 2: Text phases ──
      const phases = overlayEl.querySelectorAll('.ncm-datadrop__phase');
      [PHASE_TIMING.PHASE_TEXT_1, PHASE_TIMING.PHASE_TEXT_2, PHASE_TIMING.PHASE_TEXT_3].forEach((t, i) => {
        setTimeout(() => {
          if (phases[i]) {
            phases[i].classList.add('ncm-datadrop__phase--active');
            // Mark previous as done
            for (let j = 0; j < i; j++) {
              phases[j].classList.remove('ncm-datadrop__phase--active');
              phases[j].classList.add('ncm-datadrop__phase--done');
            }
          }
        }, t);
      });

      // Mark all phases done
      setTimeout(() => {
        phases.forEach(p => {
          p.classList.remove('ncm-datadrop__phase--active');
          p.classList.add('ncm-datadrop__phase--done');
        });
      }, PHASE_TIMING.PROGRESS_END);

      // ── Phase 2b: Progress bar ──
      const progressFill = overlayEl.querySelector('.ncm-datadrop__progress-fill');
      if (progressFill) {
        setTimeout(() => {
          progressFill.style.transition = `width ${PHASE_TIMING.PROGRESS_END - PHASE_TIMING.PROGRESS_START}ms ease`;
          progressFill.style.width = '100%';
        }, PHASE_TIMING.PROGRESS_START);
      }

      // ── Phase 3: Card materialization ──
      const card = overlayEl.querySelector('.ncm-datadrop__card');
      const cardName = overlayEl.querySelector('.ncm-datadrop__card-name');
      const cardEmail = overlayEl.querySelector('.ncm-datadrop__card-email');
      const cardBadges = overlayEl.querySelector('.ncm-datadrop__card-badges');
      const cardAvatar = overlayEl.querySelector('.ncm-datadrop__card-avatar');

      if (card) {
        setTimeout(() => {
          card.classList.add('ncm-datadrop__card--visible');
          cardAvatar?.classList.add('ncm-datadrop__card-avatar--visible');
        }, PHASE_TIMING.CARD_APPEAR);
      }

      if (cardName) {
        setTimeout(() => {
          cardName.classList.add('ncm-datadrop__card-name--reveal');
        }, PHASE_TIMING.CARD_NAME);
      }

      if (cardEmail) {
        setTimeout(() => {
          cardEmail.classList.add('ncm-datadrop__card-email--visible');
        }, PHASE_TIMING.CARD_EMAIL);
      }

      if (cardBadges) {
        setTimeout(() => {
          cardBadges.classList.add('ncm-datadrop__card-badges--visible');
        }, PHASE_TIMING.CARD_BADGES);
      }

      // ── Phase 4: Success status ──
      const status = overlayEl.querySelector('.ncm-datadrop__status');
      if (status) {
        setTimeout(() => {
          status.classList.add('ncm-datadrop__status--visible');
        }, PHASE_TIMING.STATUS_SUCCESS);
      }

      // ── Fadeout + cleanup ──
      setTimeout(() => {
        overlayEl.classList.add('ncm-datadrop--exiting');
        setTimeout(() => {
          overlayEl.remove();
          resolve();
        }, 300);
      }, PHASE_TIMING.FADEOUT);
    });
  }

  /**
   * Reduced animation: show everything at once with a simple fade in/out.
   * @param {HTMLElement} overlayEl
   * @returns {Promise<void>}
   */
  static _playReduced(overlayEl) {
    return new Promise((resolve) => {
      // Pre-activate everything
      overlayEl.querySelectorAll('.ncm-datadrop__node').forEach(n => n.classList.add('ncm-datadrop__node--done'));
      overlayEl.querySelectorAll('.ncm-datadrop__hop').forEach(h => h.classList.add('ncm-datadrop__hop--active'));
      overlayEl.querySelectorAll('.ncm-datadrop__phase').forEach(p => p.classList.add('ncm-datadrop__phase--done'));

      const fill = overlayEl.querySelector('.ncm-datadrop__progress-fill');
      if (fill) fill.style.width = '100%';

      const card = overlayEl.querySelector('.ncm-datadrop__card');
      if (card) card.classList.add('ncm-datadrop__card--visible');

      const avatar = overlayEl.querySelector('.ncm-datadrop__card-avatar');
      if (avatar) avatar.classList.add('ncm-datadrop__card-avatar--visible');

      const name = overlayEl.querySelector('.ncm-datadrop__card-name');
      if (name) name.classList.add('ncm-datadrop__card-name--reveal');

      const email = overlayEl.querySelector('.ncm-datadrop__card-email');
      if (email) email.classList.add('ncm-datadrop__card-email--visible');

      const badges = overlayEl.querySelector('.ncm-datadrop__card-badges');
      if (badges) badges.classList.add('ncm-datadrop__card-badges--visible');

      const status = overlayEl.querySelector('.ncm-datadrop__status');
      if (status) status.classList.add('ncm-datadrop__status--visible');

      document.body.appendChild(overlayEl);
      void overlayEl.offsetHeight;
      overlayEl.classList.add('ncm-datadrop--active');

      // Hold for 2 seconds then fade out
      setTimeout(() => {
        overlayEl.classList.add('ncm-datadrop--exiting');
        setTimeout(() => {
          overlayEl.remove();
          resolve();
        }, 300);
      }, 2000);
    });
  }

  /**
   * Fallback: build overlay DOM manually if template unavailable.
   * @param {object} data — Template data
   * @returns {HTMLElement}
   */
  static _buildFallback(data) {
    const el = document.createElement('div');
    el.classList.add('ncm-datadrop');

    el.innerHTML = `
      <div class="ncm-datadrop__route">
        <span class="ncm-datadrop__node">${data.senderName}</span>
        <span class="ncm-datadrop__hop">→→→</span>
        <span class="ncm-datadrop__node">${data.relayName}</span>
        <span class="ncm-datadrop__hop">→→→</span>
        <span class="ncm-datadrop__node">${data.recipientName}</span>
      </div>
      <div class="ncm-datadrop__phases">
        <div class="ncm-datadrop__phase">Establishing connection...</div>
        <div class="ncm-datadrop__phase">Authenticating sender...</div>
        <div class="ncm-datadrop__phase">Transmitting contact data...</div>
      </div>
      <div class="ncm-datadrop__progress">
        <div class="ncm-datadrop__progress-fill" style="width: 0%;"></div>
      </div>
      <div class="ncm-datadrop__card">
        <div class="ncm-datadrop__card-avatar" style="color: ${data.avatarColor};">
          ${data.portrait ? `<img src="${data.portrait}" alt="${data.contactName}">` : data.initials}
        </div>
        <div class="ncm-datadrop__card-info">
          <div class="ncm-datadrop__card-name">${data.contactName}</div>
          <div class="ncm-datadrop__card-email">${data.contactEmail}</div>
          <div class="ncm-datadrop__card-badges">
            ${data.role ? `<span class="ncm-badge">${data.role}</span>` : ''}
            ${data.tags.map(t => `<span class="ncm-badge">${t}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="ncm-datadrop__status">${data.statusText}</div>
    `;

    return el;
  }
}
