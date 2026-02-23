/**
 * Notification Service
 * @file scripts/services/NotificationService.js
 * @module cyberpunkred-messenger
 * @description Manages toast notifications for new messages, unread badge counts
 * on scene controls, and notification stacking/dismissal logic.
 */

import { MODULE_ID, EVENTS } from '../utils/constants.js';

export class NotificationService {
  constructor() {
    /** @type {Array} Active toast notifications */
    this._toasts = [];
    /** @type {number} Max visible toasts */
    this._maxToasts = 3;
    /** @type {HTMLElement|null} Toast container element */
    this._container = null;
    /** @type {Map<string, number>} Unread counts per actor */
    this._unreadCounts = new Map();
  }

  // ─── Service Accessors ────────────────────────────────────

  get eventBus() { return game.nightcity.eventBus; }
  get soundService() { return game.nightcity.soundService; }

  // ─── Initialization ───────────────────────────────────────

  /**
   * Initialize the notification system — creates toast container, sets up events.
   */
  init() {
    this._createToastContainer();
    this._setupEventListeners();
    this._refreshAllUnreadCounts();
    console.log(`${MODULE_ID} | NotificationService initialized`);
  }

  // ─── Toast Notifications ──────────────────────────────────

  /**
   * Show a new message notification toast.
   * @param {Object} data
   * @param {string} data.from - Sender email
   * @param {string} data.subject - Message subject
   * @param {string} data.preview - Body preview text
   * @param {string} data.priority - normal/urgent/critical
   * @param {string} data.messageId
   * @param {string} data.toActorId
   */
  showMessageNotification(data) {
    const toast = {
      id: foundry.utils.randomID(),
      type: 'message',
      from: data.from || 'Unknown',
      subject: data.subject || '(no subject)',
      preview: data.preview || '',
      priority: data.priority || 'normal',
      messageId: data.messageId,
      toActorId: data.toActorId,
      timestamp: Date.now(),
    };

    this._addToast(toast);
    this._updateUnreadBadge(data.toActorId);
  }

  /**
   * Show a generic notification toast.
   * @param {string} title
   * @param {string} message
   * @param {string} [type='info'] - info/warning/error/success
   * @param {number} [duration=4000]
   */
  showToast(title, message, type = 'info', duration = 4000) {
    const toast = {
      id: foundry.utils.randomID(),
      type,
      title,
      message,
      timestamp: Date.now(),
      duration,
    };
    this._addToast(toast);
  }

  /**
   * Add a toast to the stack.
   * @param {Object} toast
   */
  _addToast(toast) {
    this._toasts.push(toast);

    // Collapse oldest if over max
    while (this._toasts.length > this._maxToasts) {
      const oldest = this._toasts.shift();
      this._removeToastElement(oldest.id);
    }

    this._renderToast(toast);

    // Auto-dismiss (critical messages stay longer)
    const duration = toast.priority === 'critical' ? 8000 : (toast.duration || 4000);
    if (toast.priority !== 'critical') {
      setTimeout(() => this.dismissToast(toast.id), duration);
    }
  }

  /**
   * Dismiss a toast notification.
   * @param {string} toastId
   */
  dismissToast(toastId) {
    this._toasts = this._toasts.filter(t => t.id !== toastId);
    this._removeToastElement(toastId);
  }

  /**
   * Render a toast element in the container.
   * @param {Object} toast
   */
  _renderToast(toast) {
    if (!this._container) this._createToastContainer();

    const el = document.createElement('div');
    el.classList.add('ncm-toast', `ncm-toast--${toast.type}`);
    if (toast.priority === 'urgent' || toast.priority === 'critical') {
      el.classList.add('ncm-toast--urgent');
    }
    el.dataset.toastId = toast.id;

    if (toast.type === 'message') {
      el.innerHTML = `
        <div class="ncm-toast__icon"><i class="fas fa-envelope"></i></div>
        <div class="ncm-toast__content">
          <div class="ncm-toast__title">New Message</div>
          <div class="ncm-toast__from">${this._escapeHtml(toast.from)}</div>
          <div class="ncm-toast__subject">${this._escapeHtml(toast.subject)}</div>
          ${toast.preview ? `<div class="ncm-toast__preview">"${this._escapeHtml(toast.preview.substring(0, 60))}..."</div>` : ''}
        </div>
        <div class="ncm-toast__actions">
          <button class="ncm-toast__btn ncm-toast__btn--view" data-action="view-message" 
                  data-message-id="${toast.messageId}" data-actor-id="${toast.toActorId}">View</button>
          <button class="ncm-toast__btn ncm-toast__btn--close" data-action="dismiss">×</button>
        </div>
      `;
    } else {
      el.innerHTML = `
        <div class="ncm-toast__icon"><i class="fas fa-${toast.type === 'error' ? 'exclamation-triangle' : toast.type === 'warning' ? 'exclamation-circle' : 'info-circle'}"></i></div>
        <div class="ncm-toast__content">
          <div class="ncm-toast__title">${this._escapeHtml(toast.title)}</div>
          <div class="ncm-toast__message">${this._escapeHtml(toast.message)}</div>
        </div>
        <div class="ncm-toast__actions">
          <button class="ncm-toast__btn ncm-toast__btn--close" data-action="dismiss">×</button>
        </div>
      `;
    }

    // Event listeners
    el.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
      this.dismissToast(toast.id);
    });

    el.querySelector('[data-action="view-message"]')?.addEventListener('click', (e) => {
      const { messageId, actorId } = e.currentTarget.dataset;
      this.dismissToast(toast.id);
      // Open inbox to this message
      game.nightcity.openInbox?.(actorId, messageId);
    });

    // Slide-in animation
    el.style.transform = 'translateX(120%)';
    el.style.opacity = '0';
    this._container.appendChild(el);

    requestAnimationFrame(() => {
      el.style.transition = 'all 0.3s ease';
      el.style.transform = 'translateX(0)';
      el.style.opacity = '1';
    });
  }

  /**
   * Remove a toast element from DOM.
   * @param {string} toastId
   */
  _removeToastElement(toastId) {
    const el = this._container?.querySelector(`[data-toast-id="${toastId}"]`);
    if (!el) return;

    el.style.transition = 'all 0.2s ease';
    el.style.transform = 'translateX(120%)';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  }

  /**
   * Create the toast container element.
   */
  _createToastContainer() {
    // Remove existing container if any
    document.getElementById('ncm-toast-container')?.remove();

    this._container = document.createElement('div');
    this._container.id = 'ncm-toast-container';
    this._container.classList.add('ncm-toast-container');
    document.body.appendChild(this._container);
  }

  // ─── Unread Badge ─────────────────────────────────────────

  /**
   * Public method to refresh the unread badge for all owned actors.
   * Called externally by registerMessagingSystem event wiring and postReady.
   */
  async refreshBadge() {
    return this._refreshAllUnreadCounts();
  }

  /**
   * Update the unread count for an actor and refresh the badge.
   * @param {string} actorId
   */
  async _updateUnreadBadge(actorId) {
    try {
      const messageService = game.nightcity.messageService;
      if (!messageService) return;

      const count = await messageService.getUnreadCount(actorId);
      this._unreadCounts.set(actorId, count);

      this._renderSceneControlBadge();
    } catch (error) {
      console.error(`${MODULE_ID} | NotificationService._updateUnreadBadge:`, error);
    }
  }

  /**
   * Get the total unread count across all owned actors.
   * @returns {number}
   */
  getTotalUnreadCount() {
    let total = 0;
    for (const [actorId, count] of this._unreadCounts) {
      const actor = game.actors.get(actorId);
      if (actor?.isOwner) total += count;
    }
    return total;
  }

  /**
   * Refresh unread counts for all actors the current user owns.
   */
  async _refreshAllUnreadCounts() {
    try {
      const messageRepo = game.nightcity?.messageRepository;
      if (!messageRepo) return;

      for (const actor of game.actors) {
        if (!actor.isOwner) continue;
        const count = await messageRepo.getUnreadCount(actor.id);
        this._unreadCounts.set(actor.id, count);
      }
      this._renderSceneControlBadge();
    } catch (error) {
      console.error(`${MODULE_ID} | NotificationService._refreshAllUnreadCounts:`, error);
    }
  }

  /**
   * Render/update the unread count badge on scene controls.
   */
  _renderSceneControlBadge() {
    const total = this.getTotalUnreadCount();

    // Find the NCM scene control button
    const controlBtn = document.querySelector(`[data-tool="ncm-inbox"], .scene-control[data-control="ncm-controls"]`);
    if (!controlBtn) return;

    // Remove existing badge
    controlBtn.querySelector('.ncm-unread-badge')?.remove();

    if (total > 0) {
      const badge = document.createElement('span');
      badge.classList.add('ncm-unread-badge');
      badge.textContent = total > 99 ? '99+' : total;

      // Pulse animation on new messages
      badge.classList.add('ncm-badge-pulse');
      setTimeout(() => badge.classList.remove('ncm-badge-pulse'), 1000);

      controlBtn.style.position = 'relative';
      controlBtn.appendChild(badge);
    }
  }

  // ─── Event Listeners ──────────────────────────────────────

  _setupEventListeners() {
    if (!this.eventBus) return;

    this.eventBus.on(EVENTS.MESSAGE_RECEIVED, (data) => {
      this._updateUnreadBadge(data.toActorId);
    });

    this.eventBus.on(EVENTS.MESSAGE_READ, (data) => {
      this._updateUnreadBadge(data.actorId);
    });

    this.eventBus.on(EVENTS.MESSAGE_DELETED, () => {
      // Refresh all counts
      this._refreshAllUnreadCounts();
    });
  }

  // ─── Helpers ──────────────────────────────────────────────

  _escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Clean up — remove container from DOM.
   */
  destroy() {
    this._container?.remove();
    this._toasts = [];
  }
}
