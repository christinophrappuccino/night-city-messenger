/**
 * Notification Service
 * @file scripts/services/NotificationService.js
 * @module cyberpunkred-messenger
 * @description Manages toast notifications, unread badge counts on scene controls,
 *   and notification stacking/dismissal logic.
 *
 */

import { MODULE_ID, EVENTS, TEMPLATES } from '../utils/constants.js';

/**
 * Toast type definitions.
 * Maps type key → { icon, titleIcon }
 * Accent colors handled via CSS variant classes (ncm-toast--{type}).
 * @type {Record<string, {icon: string, titleIcon: string|null}>}
 */
const TOAST_TYPES = {
  'info': {
    icon: 'fas fa-info-circle',
    titleIcon: null,
  },
  'success': {
    icon: 'fas fa-check-circle',
    titleIcon: null,
  },
  'warning': {
    icon: 'fas fa-exclamation-circle',
    titleIcon: null,
  },
  'error': {
    icon: 'fas fa-exclamation-triangle',
    titleIcon: null,
  },
  'message': {
    icon: 'fas fa-envelope',
    titleIcon: null,
  },
  'contact-acquired': {
    icon: 'fas fa-user-plus',
    titleIcon: 'fas fa-download',
  },
  'contact-burned': {
    icon: 'fas fa-triangle-exclamation',
    titleIcon: 'fas fa-fire',
  },
  'net-switch': {
    icon: 'fas fa-arrows-rotate',
    titleIcon: null,
  },
  'net-connect': {
    icon: 'fas fa-plug',
    titleIcon: null,
  },
  'net-disconnect': {
    icon: 'fas fa-plug-circle-xmark',
    titleIcon: null,
  },
  'net-auth': {
    icon: 'fas fa-lock',
    titleIcon: null,
  },
  'net-queue': {
    icon: 'fas fa-paper-plane',
    titleIcon: null,
  },
};

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

  // ═══════════════════════════════════════════════════════════
  //  Initialization
  // ═══════════════════════════════════════════════════════════

  /**
   * Initialize the notification system — creates toast container, sets up events.
   */
  init() {
    this._createToastContainer();
    this._setupEventListeners();
    this._refreshAllUnreadCounts();
    console.log(`${MODULE_ID} | NotificationService initialized`);
  }

  // ═══════════════════════════════════════════════════════════
  //  Toast API — Sprint 3.9
  // ═══════════════════════════════════════════════════════════

  /**
   * Show a toast notification (Sprint 3.9 full API).
   *
   * @param {object} data — Toast configuration
   * @param {string} data.type — Toast type: 'info'|'success'|'warning'|'error'|'message'|'contact-acquired'|'contact-burned'
   * @param {string} data.title — Header text
   * @param {string} [data.detail] — Body text
   * @param {string} [data.icon] — Override icon class
   * @param {string} [data.titleIcon] — Override title icon class
   * @param {string} [data.accentColor] — Override accent color (CSS value)
   * @param {string} [data.actionLabel] — Action button text (e.g. "VIEW")
   * @param {string} [data.actionId] — Data attribute for action routing
   * @param {Function} [data.onAction] — Callback when action button clicked
   * @param {number} [data.duration=5000] — Auto-dismiss ms (0 = no auto-dismiss)
   * @param {string} [data.priority] — 'normal'|'urgent'|'critical'
   * @returns {string} Toast ID
   */
  showToastV2(data) {
    const id = foundry.utils.randomID();
    const typeDef = TOAST_TYPES[data.type] || TOAST_TYPES.info;

    const toast = {
      id,
      type: data.type || 'info',
      title: data.title || '',
      detail: data.detail || '',
      icon: data.icon || typeDef.icon,
      titleIcon: data.titleIcon || typeDef.titleIcon,
      accentColor: data.accentColor || null,
      actionLabel: data.actionLabel || null,
      actionId: data.actionId || 'toast-action',
      onAction: data.onAction || null,
      duration: data.duration ?? 5000,
      priority: data.priority || 'normal',
      timestamp: Date.now(),
      _dismissTimer: null,
    };

    this._addToast(toast);
    return id;
  }

  /**
   * Show a "Contact Acquired" toast.
   * @param {object} data — { contactName, senderName, network, actorId, contactId }
   * @returns {string} Toast ID
   */
  showContactAcquired(data) {
    return this.showToastV2({
      type: 'contact-acquired',
      title: 'New Contact Acquired',
      detail: `${data.contactName} — shared by ${data.senderName} via ${data.network || 'CITINET'}`,
      actionLabel: 'VIEW',
      onAction: () => {
        if (game.nightcity?.openContacts) {
          game.nightcity.openContacts(data.actorId, data.contactId);
        }
      },
      duration: 6000,
    });
  }

  /**
   * Show a "Contact Burned" toast.
   * @param {object} data — { contactName, actorId, contactId }
   * @returns {string} Toast ID
   */
  showContactBurned(data) {
    return this.showToastV2({
      type: 'contact-burned',
      title: 'Contact Burned',
      detail: `${data.contactName} — identity compromised. Use caution.`,
      actionLabel: 'VIEW',
      onAction: () => {
        if (game.nightcity?.openContacts) {
          game.nightcity.openContacts(data.actorId, data.contactId);
        }
      },
      duration: 8000,
      priority: 'urgent',
    });
  }

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
    const preview = data.preview
      ? `"${data.preview.substring(0, 60)}..."`
      : '';

    this.showToastV2({
      type: 'message',
      title: 'New Message',
      detail: `${data.from || 'Unknown'} — ${data.subject || '(no subject)'}${preview ? ` ${preview}` : ''}`,
      actionLabel: 'View',
      onAction: () => {
        game.nightcity.openInbox?.(data.toActorId, data.messageId);
      },
      duration: data.priority === 'critical' ? 0 : (data.priority === 'urgent' ? 8000 : 5000),
      priority: data.priority || 'normal',
    });

    this._updateUnreadBadge(data.toActorId);
  }

  /**
   * Show a generic notification toast (legacy compat).
   * Wraps showToastV2() — keeps backward compatibility with existing callers.
   *
   * @param {string} title
   * @param {string} message
   * @param {string} [type='info'] - info/warning/error/success
   * @param {number} [duration=4000]
   * @returns {string} Toast ID
   */
  showToast(title, message, type = 'info', duration = 4000) {
    return this.showToastV2({
      type,
      title,
      detail: message,
      duration,
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Network Event Toasts
  // ═══════════════════════════════════════════════════════════

  /**
   * Show a "Network Switched" toast.
   * Triggered by EVENTS.NETWORK_CHANGED when switching between networks.
   * @param {object} data — EventBus payload
   * @param {string} data.previousNetworkId
   * @param {string} data.currentNetworkId
   * @param {object} data.network — Full network object
   * @param {number} data.signalStrength
   * @returns {string} Toast ID
   */
  showNetworkSwitch(data) {
    const networkService = game.nightcity?.networkService;
    const prevNetwork = networkService?.getNetwork?.(data.previousNetworkId);
    const prevName = prevNetwork?.name || 'Unknown';
    const newName = data.network?.name || 'Unknown';
    const signal = data.signalStrength ?? 0;

    return this.showToastV2({
      type: 'net-switch',
      title: 'Network Switched',
      detail: `${prevName} → ${newName} // Signal ${signal}%`,
      duration: 4000,
    });
  }

  /**
   * Show a "Connected" toast.
   * Triggered by EVENTS.NETWORK_CONNECTED (e.g. leaving dead zone,
   * successful auth, or manual reconnect).
   * @param {object} data
   * @param {string} data.networkId
   * @returns {string} Toast ID
   */
  showNetworkConnect(data) {
    const networkService = game.nightcity?.networkService;
    const network = networkService?.getNetwork?.(data.networkId);
    const name = network?.name || 'Unknown';
    const signal = network?.signalStrength ?? 0;

    return this.showToastV2({
      type: 'net-connect',
      title: 'Connected',
      detail: `Authenticated to ${name} // Signal ${signal}%`,
      duration: 4000,
    });
  }

  /**
   * Show a "Signal Lost" toast.
   * Triggered by EVENTS.NETWORK_DISCONNECTED.
   * @param {object} data
   * @param {string} data.reason — 'dead_zone' | 'auth_revoked' | etc.
   * @returns {string} Toast ID
   */
  showNetworkDisconnect(data) {
    const reason = data?.reason || 'unknown';
    let detail;

    switch (reason) {
      case 'dead_zone':
        detail = 'Entered dead zone — messages queued';
        break;
      case 'auth_revoked':
        detail = 'Authentication revoked by network admin';
        break;
      default:
        detail = 'Connection lost — attempting to reconnect';
    }

    return this.showToastV2({
      type: 'net-disconnect',
      title: 'Signal Lost',
      detail,
      duration: 5000,
      priority: 'urgent',
    });
  }

  /**
   * Show an "Auth Required" toast.
   * Typically triggered when switchNetwork returns reason: 'auth_required',
   * or can be called directly.
   * @param {object} data
   * @param {string} data.networkName — Network name
   * @param {string} [data.networkId] — Network ID for action routing
   * @returns {string} Toast ID
   */
  showNetworkAuthRequired(data) {
    const name = data?.networkName || data?.network?.name || 'Unknown';
    const networkId = data?.networkId || data?.network?.id;

    return this.showToastV2({
      type: 'net-auth',
      title: 'Auth Required',
      detail: `${name} requires authentication to connect`,
      duration: 5000,
      actionLabel: networkId ? 'AUTH' : null,
      onAction: networkId ? () => {
        game.nightcity?.connectToNetwork?.(networkId);
      } : null,
    });
  }

  /**
   * Show a "Queue Delivered" toast.
   * Triggered by EVENTS.QUEUE_FLUSHED when signal is restored.
   * @param {object} data
   * @param {number} data.count — Number of messages delivered
   * @returns {string} Toast ID
   */
  showQueueFlush(data) {
    const count = data?.count ?? 0;
    if (count === 0) return null;

    return this.showToastV2({
      type: 'net-queue',
      title: 'Queue Delivered',
      detail: `${count} queued message${count !== 1 ? 's' : ''} sent on signal restore`,
      duration: 5000,
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Toast Queue Management
  // ═══════════════════════════════════════════════════════════

  /**
   * Add a toast to the stack with queue management.
   * @param {object} toast
   */
  _addToast(toast) {
    this._toasts.push(toast);

    // Collapse oldest if over max
    while (this._toasts.length > this._maxToasts) {
      const oldest = this._toasts.shift();
      this._removeToastElement(oldest.id);
      if (oldest._dismissTimer) clearTimeout(oldest._dismissTimer);
    }

    this._renderToast(toast);

    // Auto-dismiss (unless duration is 0 or priority is critical)
    if (toast.duration > 0 && toast.priority !== 'critical') {
      const effectiveDuration = toast.priority === 'urgent'
        ? Math.round(toast.duration * 1.5)
        : toast.duration;
      toast._dismissTimer = setTimeout(() => this.dismissToast(toast.id), effectiveDuration);
    }
  }

  /**
   * Dismiss a toast notification with exit animation.
   * @param {string} toastId
   */
  dismissToast(toastId) {
    const toast = this._toasts.find(t => t.id === toastId);
    if (toast?._dismissTimer) clearTimeout(toast._dismissTimer);

    this._toasts = this._toasts.filter(t => t.id !== toastId);
    this._removeToastElement(toastId);
  }

  // ═══════════════════════════════════════════════════════════
  //  Toast Rendering
  // ═══════════════════════════════════════════════════════════

  /**
   * Render a toast. Tries Handlebars template first, falls back to raw DOM.
   * @param {object} toast
   */
  async _renderToast(toast) {
    if (!this._container) this._createToastContainer();

    try {
      // Attempt template-based rendering
      const html = await renderTemplate(TEMPLATES.PARTIAL_TOAST, {
        id: toast.id,
        type: toast.type,
        title: toast.title,
        detail: toast.detail,
        icon: toast.icon,
        titleIcon: toast.titleIcon,
        accentColor: toast.accentColor,
        actionLabel: toast.actionLabel,
        actionId: toast.actionId,
        duration: toast.duration > 0 ? toast.duration : null,
      });

      const wrapper = document.createElement('div');
      wrapper.innerHTML = html.trim();
      const el = wrapper.firstElementChild;

      if (!el) throw new Error('Template rendered empty');

      // Add urgent class if needed
      if (toast.priority === 'urgent' || toast.priority === 'critical') {
        el.classList.add('ncm-toast--urgent');
      }

      this._wireToastEvents(el, toast);
      this._container.appendChild(el);
      this._startProgressBar(el, toast);

    } catch (error) {
      // Fallback: render raw DOM if template not available
      console.warn(`${MODULE_ID} | Toast template render failed, using fallback:`, error.message);
      this._renderToastFallback(toast);
    }
  }

  /**
   * Fallback raw DOM renderer (works even if toast.hbs isn't preloaded).
   * @param {object} toast
   */
  _renderToastFallback(toast) {
    const el = document.createElement('div');
    el.classList.add('ncm-toast', `ncm-toast--${toast.type}`);
    el.dataset.toastId = toast.id;

    if (toast.priority === 'urgent' || toast.priority === 'critical') {
      el.classList.add('ncm-toast--urgent');
    }

    el.innerHTML = `
      <div class="ncm-toast__icon"><i class="${toast.icon}"></i></div>
      <div class="ncm-toast__body">
        <div class="ncm-toast__title">
          ${toast.titleIcon ? `<i class="${toast.titleIcon}"></i> ` : ''}${this._escapeHtml(toast.title)}
        </div>
        ${toast.detail ? `<div class="ncm-toast__detail">${this._escapeHtml(toast.detail)}</div>` : ''}
      </div>
      ${toast.actionLabel ? `<button class="ncm-toast__action" data-action="${toast.actionId}" data-toast-id="${toast.id}">${toast.actionLabel}</button>` : ''}
      <button class="ncm-toast__dismiss" data-action="dismiss-toast" data-toast-id="${toast.id}"><i class="fas fa-xmark"></i></button>
      ${toast.duration > 0 ? `<div class="ncm-toast__progress"><div class="ncm-toast__progress-fill"></div></div>` : ''}
    `;

    this._wireToastEvents(el, toast);
    this._container.appendChild(el);
    this._startProgressBar(el, toast);
  }

  /**
   * Wire event listeners on a rendered toast element.
   * @param {HTMLElement} el
   * @param {object} toast
   */
  _wireToastEvents(el, toast) {
    // Dismiss button
    el.querySelector('[data-action="dismiss-toast"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissToast(toast.id);
    });

    // Action button
    const actionBtn = el.querySelector('.ncm-toast__action');
    if (actionBtn && toast.onAction) {
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toast.onAction();
        this.dismissToast(toast.id);
      });
    }

    // Pause auto-dismiss on hover (timer management)
    if (toast.duration > 0 && toast.priority !== 'critical') {
      let remainingTime = toast.priority === 'urgent'
        ? Math.round(toast.duration * 1.5)
        : toast.duration;
      let enterTime = 0;

      el.addEventListener('mouseenter', () => {
        enterTime = Date.now();
        if (toast._dismissTimer) clearTimeout(toast._dismissTimer);
      });

      el.addEventListener('mouseleave', () => {
        const elapsed = Date.now() - enterTime;
        remainingTime = Math.max(remainingTime - elapsed, 1000);
        toast._dismissTimer = setTimeout(() => this.dismissToast(toast.id), remainingTime);
      });
    }
  }

  /**
   * Start the progress bar countdown animation on a toast element.
   * @param {HTMLElement} el
   * @param {object} toast
   */
  _startProgressBar(el, toast) {
    if (toast.duration <= 0) return;

    const fill = el.querySelector('.ncm-toast__progress-fill');
    if (!fill) return;

    const effectiveDuration = toast.priority === 'urgent'
      ? Math.round(toast.duration * 1.5)
      : toast.duration;

    fill.style.setProperty('--toast-duration', `${effectiveDuration}ms`);
    // Trigger reflow before adding animation class
    void fill.offsetHeight;
    fill.classList.add('ncm-toast__progress--active');
  }

  /**
   * Remove a toast element from DOM with exit animation.
   * @param {string} toastId
   */
  _removeToastElement(toastId) {
    const el = this._container?.querySelector(`[data-toast-id="${toastId}"]`);
    if (!el) return;

    // Add exit animation class
    el.classList.add('ncm-toast--exiting');

    // Remove after animation (or immediately if animations are off)
    const animDuration = document.body.dataset.ncmAnimationLevel === 'off' ? 0 : 250;
    setTimeout(() => el.remove(), animDuration);
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

  // ═══════════════════════════════════════════════════════════
  //  Unread Badge
  // ═══════════════════════════════════════════════════════════

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
    const controlBtn = document.querySelector(
      `[data-tool="ncm-inbox"], .scene-control[data-control="ncm-controls"]`
    );
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

  // ═══════════════════════════════════════════════════════════
  //  Event Listeners
  // ═══════════════════════════════════════════════════════════

  _setupEventListeners() {
    if (!this.eventBus) return;

    this.eventBus.on(EVENTS.MESSAGE_RECEIVED, (data) => {
      this._updateUnreadBadge(data.toActorId);
    });

    this.eventBus.on(EVENTS.MESSAGE_READ, (data) => {
      this._updateUnreadBadge(data.actorId);
    });

    this.eventBus.on(EVENTS.MESSAGE_DELETED, () => {
      this._refreshAllUnreadCounts();
    });

    // ── Network Event Toasts ──

    this.eventBus.on(EVENTS.NETWORK_CHANGED, (data) => {
      // Only show toast for actual network switches (not create/update/delete)
      if (data.previousNetworkId && data.currentNetworkId
          && data.previousNetworkId !== data.currentNetworkId
          && data.network) {
        this.showNetworkSwitch(data);
      }
    });

    this.eventBus.on(EVENTS.NETWORK_CONNECTED, (data) => {
      this.showNetworkConnect(data);
    });

    this.eventBus.on(EVENTS.NETWORK_DISCONNECTED, (data) => {
      this.showNetworkDisconnect(data);
    });

    // NOTE: NETWORK_AUTH_SUCCESS is intentionally NOT wired here.
    // The auth dialog provides its own success feedback (closes + sound),
    // and the subsequent switchNetwork() call emits NETWORK_CHANGED which
    // triggers the switch toast. Wiring auth success would cause a
    // duplicate "Connected" + "Switched" toast pair within milliseconds.
    // If you want a standalone auth toast without switching, call
    // notificationService.showNetworkConnect() manually.

    this.eventBus.on(EVENTS.QUEUE_FLUSHED, (data) => {
      this.showQueueFlush(data);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Escape HTML entities in a string.
   * @param {string} str
   * @returns {string}
   */
  _escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Clean up — remove container from DOM, clear timers.
   */
  destroy() {
    // Clear all pending dismiss timers
    for (const toast of this._toasts) {
      if (toast._dismissTimer) clearTimeout(toast._dismissTimer);
    }
    this._container?.remove();
    this._toasts = [];
  }
}