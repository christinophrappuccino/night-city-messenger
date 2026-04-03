/**
 * Notification Service — v2
 * @file scripts/services/NotificationService.js
 * @module cyberpunkred-messenger
 * @description Manages toast notifications, unread badge counts on scene controls,
 *   and notification stacking/dismissal logic. v2 adds shard, message, and network
 *   toast families with hex strips, signal bars, and glitch effects.
 */

import { MODULE_ID, EVENTS, TEMPLATES } from '../utils/constants.js';

// ═══════════════════════════════════════════════════════════
//  Toast Type Definitions
// ═══════════════════════════════════════════════════════════

/**
 * Toast type → { icon, titleIcon }
 * Colors handled via CSS class `.ncm-toast--{type}` and `--toast-color` variable.
 */
const TOAST_TYPES = {
  // ── Core ──
  'info':     { icon: 'fas fa-info-circle',        titleIcon: null },
  'success':  { icon: 'fas fa-check-circle',       titleIcon: null },
  'warning':  { icon: 'fas fa-exclamation-circle',  titleIcon: null },
  'error':    { icon: 'fas fa-exclamation-triangle', titleIcon: null },
  'danger':   { icon: 'fas fa-skull-crossbones',    titleIcon: null },

  // ── Message ──
  'message':       { icon: 'fas fa-envelope',     titleIcon: null },
  'msg-sent':      { icon: 'fas fa-paper-plane',  titleIcon: null },
  'msg-scheduled': { icon: 'fas fa-clock',         titleIcon: null },
  'msg-decrypted': { icon: 'fas fa-lock-open',    titleIcon: null },

  // ── Contact ──
  'contact-acquired': { icon: 'fas fa-user-plus',              titleIcon: 'fas fa-download' },
  'contact-burned':   { icon: 'fas fa-triangle-exclamation',   titleIcon: 'fas fa-fire' },

  // ── Network ──
  'net-switch':     { icon: 'fas fa-arrows-rotate',       titleIcon: null },
  'net-connect':    { icon: 'fas fa-plug',                 titleIcon: null },
  'net-disconnect': { icon: 'fas fa-plug-circle-xmark',   titleIcon: null },
  'net-auth':       { icon: 'fas fa-lock',                 titleIcon: null },
  'net-auth-fail':  { icon: 'fas fa-lock',                 titleIcon: null },
  'net-lockout':    { icon: 'fas fa-ban',                  titleIcon: 'fas fa-shield-halved' },
  'net-queue':      { icon: 'fas fa-paper-plane',          titleIcon: null },

  // ── Shard ──
  'shard-decrypt':    { icon: 'fas fa-lock-open',        titleIcon: null },
  'shard-ice':        { icon: 'fas fa-skull-crossbones', titleIcon: 'fas fa-bolt' },
  'shard-login':      { icon: 'fas fa-terminal',         titleIcon: null },
  'shard-login-fail': { icon: 'fas fa-terminal',         titleIcon: null },
  'shard-key':        { icon: 'fas fa-key',              titleIcon: null },
  'shard-key-fail':   { icon: 'fas fa-key',              titleIcon: null },
  'shard-eddies':     { icon: 'fas fa-coins',            titleIcon: null },
  'shard-trace':      { icon: 'fas fa-satellite-dish',   titleIcon: 'fas fa-eye' },
  'shard-bricked':    { icon: 'fas fa-hard-drive',       titleIcon: 'fas fa-triangle-exclamation' },
  'shard-expired':    { icon: 'fas fa-hourglass-end',    titleIcon: null },
};

/** Types that get a scrolling hex data strip */
const HEX_STRIP_TYPES = new Set([
  'danger', 'shard-decrypt', 'shard-ice', 'shard-trace', 'shard-bricked',
]);

/** Types that get the glitch text effect */
const GLITCH_TYPES = new Set([
  'danger', 'shard-ice', 'shard-bricked', 'net-lockout',
]);

/** Types that get signal strength bars */
const SIGNAL_TYPES = new Set([
  'net-switch', 'net-connect', 'net-disconnect',
]);

/**
 * Generate a random hex data string for the hex strip.
 * @returns {string}
 */
function _generateHexData() {
  const chars = '0123456789ABCDEF';
  let result = '';
  for (let i = 0; i < 48; i++) {
    result += chars[Math.floor(Math.random() * 16)];
    result += chars[Math.floor(Math.random() * 16)];
    if (i < 47) result += ' ';
  }
  // Duplicate for seamless scroll loop
  return result + '   ' + result;
}

// ═══════════════════════════════════════════════════════════

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

  init() {
    this._createToastContainer();
    this._setupEventListeners();
    this._refreshAllUnreadCounts();
    console.log(`${MODULE_ID} | NotificationService initialized`);
  }

  // ═══════════════════════════════════════════════════════════
  //  Toast API
  // ═══════════════════════════════════════════════════════════

  /**
   * Show a toast notification.
   *
   * @param {object} data
   * @param {string} data.type — Toast type key
   * @param {string} data.title — Header text
   * @param {string} [data.detail] — Body text
   * @param {string} [data.icon] — Override icon class
   * @param {string} [data.titleIcon] — Override title icon class
   * @param {string} [data.accentColor] — CSS override color
   * @param {string} [data.actionLabel] — Action button text
   * @param {string} [data.actionId] — Data attribute for action routing
   * @param {Function} [data.onAction] — Action button callback
   * @param {number} [data.duration=5000] — Auto-dismiss ms (0 = no auto-dismiss)
   * @param {string} [data.priority] — 'normal'|'urgent'|'critical'
   * @param {number} [data.signalStrength] — 0–100, adds signal bars for network toasts
   * @param {boolean} [data.hexStrip] — Force hex strip on/off (auto-detected by type)
   * @param {boolean} [data.glitch] — Force glitch effect on/off (auto-detected by type)
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
      signalStrength: data.signalStrength ?? null,
      hexStrip: data.hexStrip ?? HEX_STRIP_TYPES.has(data.type),
      glitch: data.glitch ?? GLITCH_TYPES.has(data.type),
      timestamp: Date.now(),
      _dismissTimer: null,
    };

    this._addToast(toast);
    return id;
  }

  /**
   * Legacy wrapper — positional args → showToastV2.
   * @param {string} title
   * @param {string} message
   * @param {string} [type='info']
   * @param {number} [duration=4000]
   * @returns {string} Toast ID
   */
  showToast(title, message, type = 'info', duration = 4000) {
    return this.showToastV2({ type, title, detail: message, duration });
  }

  // ═══════════════════════════════════════════════════════════
  //  Contact Toasts
  // ═══════════════════════════════════════════════════════════

  showContactAcquired(data) {
    return this.showToastV2({
      type: 'contact-acquired',
      title: 'New Contact Acquired',
      detail: `${data.contactName} — shared by ${data.senderName} via ${data.network || 'CITINET'}`,
      actionLabel: 'VIEW',
      onAction: () => {
        game.nightcity?.openContacts?.(data.actorId, data.contactId);
      },
      duration: 6000,
    });
  }

  showContactBurned(data) {
    return this.showToastV2({
      type: 'contact-burned',
      title: 'Contact Burned',
      detail: `${data.contactName} — identity compromised. Use caution.`,
      actionLabel: 'VIEW',
      onAction: () => {
        game.nightcity?.openContacts?.(data.actorId, data.contactId);
      },
      duration: 8000,
      priority: 'urgent',
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Message Toasts
  // ═══════════════════════════════════════════════════════════

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
   * Show a "Message Sent" confirmation toast.
   * @param {object} data — { to, subject }
   */
  showMessageSent(data) {
    return this.showToastV2({
      type: 'msg-sent',
      title: 'Message Sent',
      detail: `To: ${data.to || 'Unknown'} — "${data.subject || '(no subject)'}"`,
      duration: 3000,
    });
  }

  /**
   * Show a "Message Scheduled" confirmation toast.
   * @param {object} data — { scheduledTime, subject }
   */
  showMessageScheduled(data) {
    return this.showToastV2({
      type: 'msg-scheduled',
      title: 'Message Scheduled',
      detail: `Delivery at ${data.scheduledTime || '??:??'} — "${data.subject || '(no subject)'}"`,
      duration: 4000,
    });
  }

  /**
   * Show a "Message Decrypted" toast.
   * @param {object} data — { actorId, messageId }
   */
  showMessageDecrypted(data) {
    return this.showToastV2({
      type: 'msg-decrypted',
      title: 'Message Decrypted',
      detail: 'ICE bypassed — message content revealed',
      duration: 4000,
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Network Toasts
  // ═══════════════════════════════════════════════════════════

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
      signalStrength: signal,
      duration: 4000,
    });
  }

  showNetworkConnect(data) {
    const networkService = game.nightcity?.networkService;
    const network = networkService?.getNetwork?.(data.networkId);
    const name = network?.name || 'Unknown';
    const signal = network?.signalStrength ?? 0;

    return this.showToastV2({
      type: 'net-connect',
      title: 'Connected',
      detail: `Authenticated to ${name} // Signal ${signal}%`,
      signalStrength: signal,
      duration: 4000,
    });
  }

  showNetworkDisconnect(data) {
    const reason = data?.reason || 'unknown';
    let detail;
    switch (reason) {
      case 'dead_zone':   detail = 'Entered dead zone — messages queued'; break;
      case 'auth_revoked': detail = 'Authentication revoked by network admin'; break;
      default:            detail = 'Connection lost — attempting to reconnect';
    }

    return this.showToastV2({
      type: 'net-disconnect',
      title: 'Signal Lost',
      detail,
      signalStrength: 0,
      duration: 5000,
      priority: 'urgent',
    });
  }

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
   * Show a "Network Auth Failed" toast.
   * @param {object} data — { networkId, method, attempt, maxAttempts }
   */
  showNetworkAuthFailed(data) {
    const networkService = game.nightcity?.networkService;
    const network = networkService?.getNetwork?.(data.networkId);
    const name = network?.name || 'Unknown';
    const attempt = data.attempt ?? '?';
    const max = data.maxAttempts ?? '?';

    return this.showToastV2({
      type: 'net-auth-fail',
      title: 'Auth Failed',
      detail: `${name} — invalid credentials (attempt ${attempt}/${max})`,
      duration: 5000,
    });
  }

  /**
   * Show a "Network Lockout" toast.
   * @param {object} data — { networkId, lockoutMinutes }
   */
  showNetworkLockout(data) {
    const networkService = game.nightcity?.networkService;
    const network = networkService?.getNetwork?.(data.networkId);
    const name = network?.name || 'Unknown';
    const mins = data.lockoutMinutes ?? '?';

    return this.showToastV2({
      type: 'net-lockout',
      title: 'Lockout',
      detail: `${name} — too many attempts. Locked for ${mins} min.`,
      duration: 8000,
      priority: 'urgent',
    });
  }

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
  //  Shard Toasts
  // ═══════════════════════════════════════════════════════════

  /**
   * @param {object} data — { itemName, actorId }
   */
  showShardDecrypted(data) {
    return this.showToastV2({
      type: 'shard-decrypt',
      title: 'Shard Decrypted',
      detail: `ICE bypassed — "${data.itemName || 'Unknown'}" unlocked`,
      duration: 4000,
    });
  }

  /**
   * @param {object} data — { itemName, damage, actorName }
   */
  showShardBlackICE(data) {
    return this.showToastV2({
      type: 'shard-ice',
      title: 'BLACK ICE — Shard',
      detail: `${data.damage || '?'} damage! "${data.itemName || 'Unknown'}" fights back!`,
      duration: 6000,
      priority: 'critical',
    });
  }

  /**
   * @param {object} data — { itemName }
   */
  showShardLoginSuccess(data) {
    return this.showToastV2({
      type: 'shard-login',
      title: 'Login Accepted',
      detail: `Access granted — "${data.itemName || 'Unknown'}" layer unlocked`,
      duration: 4000,
    });
  }

  /**
   * @param {object} data — { itemName, attempt, maxAttempts }
   */
  showShardLoginFailed(data) {
    const attempt = data.attempt ?? '?';
    const max = data.maxAttempts ?? '?';
    return this.showToastV2({
      type: 'shard-login-fail',
      title: 'Login Denied',
      detail: `Invalid credentials — "${data.itemName || 'Unknown'}" (attempt ${attempt}/${max})`,
      duration: 5000,
    });
  }

  /**
   * @param {object} data — { keyItemName, itemName }
   */
  showShardKeyAccepted(data) {
    return this.showToastV2({
      type: 'shard-key',
      title: 'Key Item Accepted',
      detail: `"${data.keyItemName || 'Unknown'}" → unlocked "${data.itemName || 'Unknown'}"`,
      duration: 4000,
    });
  }

  /**
   * @param {object} data — { keyItemName }
   */
  showShardKeyRejected(data) {
    return this.showToastV2({
      type: 'shard-key-fail',
      title: 'Key Item Rejected',
      detail: `"${data.keyItemName || 'Unknown'}" — incompatible with shard security`,
      duration: 5000,
    });
  }

  /**
   * @param {object} data — { amount, actorName }
   */
  showShardEddiesClaimed(data) {
    return this.showToastV2({
      type: 'shard-eddies',
      title: 'Eddies Claimed',
      detail: `+${data.amount || '?'} eb transferred to ${data.actorName || 'Unknown'}'s account`,
      duration: 4000,
    });
  }

  /**
   * @param {object} data — { itemName }
   */
  showShardTrace(data) {
    return this.showToastV2({
      type: 'shard-trace',
      title: 'Trace Detected',
      detail: `Your access has been logged — someone knows you're here`,
      duration: 6000,
      priority: 'urgent',
    });
  }

  /**
   * @param {object} data — { itemName }
   */
  showShardBricked(data) {
    return this.showToastV2({
      type: 'shard-bricked',
      title: 'Shard Bricked',
      detail: `Integrity 0% — "${data.itemName || 'Unknown'}" permanently corrupted`,
      duration: 8000,
      priority: 'urgent',
    });
  }

  /**
   * @param {object} data — { itemName }
   */
  showShardExpired(data) {
    return this.showToastV2({
      type: 'shard-expired',
      title: 'Shard Expired',
      detail: `"${data.itemName || 'Unknown'}" — time limit reached, data wiped`,
      duration: 5000,
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Toast Queue Management
  // ═══════════════════════════════════════════════════════════

  _addToast(toast) {
    this._toasts.push(toast);

    while (this._toasts.length > this._maxToasts) {
      const oldest = this._toasts.shift();
      this._removeToastElement(oldest.id);
      if (oldest._dismissTimer) clearTimeout(oldest._dismissTimer);
    }

    this._renderToast(toast);

    if (toast.duration > 0 && toast.priority !== 'critical') {
      const effectiveDuration = toast.priority === 'urgent'
        ? Math.round(toast.duration * 1.5)
        : toast.duration;
      toast._dismissTimer = setTimeout(() => this.dismissToast(toast.id), effectiveDuration);
    }
  }

  dismissToast(toastId) {
    const toast = this._toasts.find(t => t.id === toastId);
    if (toast?._dismissTimer) clearTimeout(toast._dismissTimer);
    this._toasts = this._toasts.filter(t => t.id !== toastId);
    this._removeToastElement(toastId);
  }

  // ═══════════════════════════════════════════════════════════
  //  Toast Rendering
  // ═══════════════════════════════════════════════════════════

  async _renderToast(toast) {
    if (!this._container) this._createToastContainer();

    try {
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

      // Add modifier classes
      if (toast.priority === 'urgent' || toast.priority === 'critical') {
        el.classList.add('ncm-toast--urgent');
      }
      if (toast.priority === 'critical') {
        el.classList.add('ncm-toast--critical');
      }
      if (toast.glitch) {
        el.classList.add('ncm-toast--glitch');
      }

      // Inject optional elements
      this._injectHexStrip(el, toast);
      this._injectSignalBars(el, toast);

      this._wireToastEvents(el, toast);
      this._container.appendChild(el);
      this._startProgressBar(el, toast);

    } catch (error) {
      console.warn(`${MODULE_ID} | Toast template render failed, using fallback:`, error.message);
      this._renderToastFallback(toast);
    }
  }

  /**
   * Fallback raw DOM renderer.
   */
  _renderToastFallback(toast) {
    const el = document.createElement('div');
    el.classList.add('ncm-toast', `ncm-toast--${toast.type}`);
    el.dataset.toastId = toast.id;

    if (toast.priority === 'urgent' || toast.priority === 'critical') {
      el.classList.add('ncm-toast--urgent');
    }
    if (toast.priority === 'critical') {
      el.classList.add('ncm-toast--critical');
    }
    if (toast.glitch) {
      el.classList.add('ncm-toast--glitch');
    }

    el.innerHTML = `
      <div class="ncm-toast__accent"></div>
      <div class="ncm-toast__icon"><i class="${toast.icon}"></i></div>
      <div class="ncm-toast__body">
        <div class="ncm-toast__title">
          ${toast.titleIcon ? `<i class="${toast.titleIcon}"></i> ` : ''}${this._escapeHtml(toast.title)}
        </div>
        <div class="ncm-toast__separator"></div>
        ${toast.detail ? `<div class="ncm-toast__detail">${this._escapeHtml(toast.detail)}</div>` : ''}
      </div>
      ${toast.actionLabel ? `<button class="ncm-toast__action" data-action="${toast.actionId}" data-toast-id="${toast.id}">${toast.actionLabel}</button>` : ''}
      <button class="ncm-toast__dismiss" data-action="dismiss-toast" data-toast-id="${toast.id}"><i class="fas fa-xmark"></i></button>
      ${toast.duration > 0 ? `<div class="ncm-toast__progress"><div class="ncm-toast__progress-fill"></div></div>` : ''}
    `;

    // Inject optional elements
    this._injectHexStrip(el, toast);
    this._injectSignalBars(el, toast);

    this._wireToastEvents(el, toast);
    this._container.appendChild(el);
    this._startProgressBar(el, toast);
  }

  // ═══════════════════════════════════════════════════════════
  //  Optional Element Injection
  // ═══════════════════════════════════════════════════════════

  /**
   * Inject scrolling hex data strip for shard/danger toasts.
   */
  _injectHexStrip(el, toast) {
    if (!toast.hexStrip) return;
    const strip = document.createElement('div');
    strip.classList.add('ncm-toast__hex-strip');
    const span = document.createElement('span');
    span.textContent = _generateHexData();
    strip.appendChild(span);
    el.appendChild(strip);
  }

  /**
   * Inject signal strength bars for network toasts.
   */
  _injectSignalBars(el, toast) {
    if (toast.signalStrength === null && !SIGNAL_TYPES.has(toast.type)) return;

    const signal = toast.signalStrength ?? 0;
    const activeBars = signal >= 80 ? 4 : signal >= 55 ? 3 : signal >= 30 ? 2 : signal > 0 ? 1 : 0;

    const container = document.createElement('div');
    container.classList.add('ncm-toast__signal');

    for (let i = 0; i < 4; i++) {
      const bar = document.createElement('div');
      bar.classList.add('ncm-toast__signal-bar');
      if (i < activeBars) bar.classList.add('ncm-toast__signal-bar--active');
      container.appendChild(bar);
    }

    // Insert before the dismiss button
    const dismiss = el.querySelector('.ncm-toast__dismiss');
    if (dismiss) {
      el.insertBefore(container, dismiss);
    } else {
      el.appendChild(container);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Toast Event Wiring
  // ═══════════════════════════════════════════════════════════

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

    // Pause auto-dismiss on hover
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

  _startProgressBar(el, toast) {
    if (toast.duration <= 0) return;
    const fill = el.querySelector('.ncm-toast__progress-fill');
    if (!fill) return;

    const effectiveDuration = toast.priority === 'urgent'
      ? Math.round(toast.duration * 1.5)
      : toast.duration;

    fill.style.setProperty('--toast-duration', `${effectiveDuration}ms`);
    void fill.offsetHeight;
    fill.classList.add('ncm-toast__progress--active');
  }

  _removeToastElement(toastId) {
    const el = this._container?.querySelector(`[data-toast-id="${toastId}"]`);
    if (!el) return;

    el.classList.add('ncm-toast--exiting');
    const animDuration = document.body.dataset.ncmAnimationLevel === 'off' ? 0 : 250;
    setTimeout(() => el.remove(), animDuration);
  }

  _createToastContainer() {
    document.getElementById('ncm-toast-container')?.remove();
    this._container = document.createElement('div');
    this._container.id = 'ncm-toast-container';
    this._container.classList.add('ncm-toast-container');
    document.body.appendChild(this._container);
  }

  // ═══════════════════════════════════════════════════════════
  //  Unread Badge
  // ═══════════════════════════════════════════════════════════

  async refreshBadge() {
    return this._refreshAllUnreadCounts();
  }

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

  getTotalUnreadCount() {
    let total = 0;
    for (const [actorId, count] of this._unreadCounts) {
      const actor = game.actors.get(actorId);
      if (actor?.isOwner) total += count;
    }
    return total;
  }

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

  _renderSceneControlBadge() {
    const total = this.getTotalUnreadCount();
    const controlBtn = document.querySelector(
      `[data-tool="ncm-inbox"], .scene-control[data-control="ncm-controls"]`
    );
    if (!controlBtn) return;

    controlBtn.querySelector('.ncm-unread-badge')?.remove();

    if (total > 0) {
      const badge = document.createElement('span');
      badge.classList.add('ncm-unread-badge');
      badge.textContent = total > 99 ? '99+' : total;
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

    // ── Badge updates ──
    this.eventBus.on(EVENTS.MESSAGE_RECEIVED, (data) => {
      this._updateUnreadBadge(data.toActorId);
    });

    this.eventBus.on(EVENTS.MESSAGE_READ, (data) => {
      this._updateUnreadBadge(data.actorId);
    });

    this.eventBus.on(EVENTS.MESSAGE_DELETED, () => {
      this._refreshAllUnreadCounts();
    });

    // ── Network toasts ──
    this.eventBus.on(EVENTS.NETWORK_CHANGED, (data) => {
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

    this.eventBus.on(EVENTS.QUEUE_FLUSHED, (data) => {
      this.showQueueFlush(data);
    });

    // ── Network auth failure + lockout (NEW) ──
    this.eventBus.on(EVENTS.NETWORK_AUTH_FAILURE, (data) => {
      this.showNetworkAuthFailed(data);
    });

    this.eventBus.on(EVENTS.NETWORK_LOCKOUT, (data) => {
      this.showNetworkLockout(data);
    });

    // ── Shard toasts (NEW) ──
    this.eventBus.on(EVENTS.SHARD_DECRYPTED, (data) => {
      const item = game.items?.get(data.itemId);
      this.showShardDecrypted({ itemName: item?.name || 'Unknown', actorId: data.actorId });
    });

    this.eventBus.on(EVENTS.BLACK_ICE_DAMAGE, (data) => {
      const item = game.items?.get(data.itemId);
      const actor = game.actors?.get(data.actorId);
      this.showShardBlackICE({
        itemName: item?.name || 'Unknown',
        damage: data.damage,
        actorName: actor?.name || 'Unknown',
      });
    });

    this.eventBus.on(EVENTS.SHARD_LOGIN_SUCCESS, (data) => {
      const item = game.items?.get(data.itemId);
      this.showShardLoginSuccess({ itemName: item?.name || 'Unknown' });
    });

    this.eventBus.on(EVENTS.SHARD_LOGIN_FAILURE, (data) => {
      const item = game.items?.get(data.itemId);
      this.showShardLoginFailed({
        itemName: item?.name || 'Unknown',
        attempt: data.attempt,
        maxAttempts: data.maxAttempts,
      });
    });

    this.eventBus.on(EVENTS.SHARD_KEY_ITEM_PRESENTED, (data) => {
      const item = game.items?.get(data.itemId);
      this.showShardKeyAccepted({
        keyItemName: data.keyItemName || 'Unknown',
        itemName: item?.name || 'Unknown',
      });
    });

    this.eventBus.on(EVENTS.SHARD_KEY_ITEM_FAILED, (data) => {
      this.showShardKeyRejected({ keyItemName: data.keyItemName || 'Unknown' });
    });

    this.eventBus.on(EVENTS.SHARD_EDDIES_CLAIMED, (data) => {
      const actor = game.actors?.get(data.actorId);
      this.showShardEddiesClaimed({
        amount: data.amount,
        actorName: actor?.name || 'Unknown',
      });
    });

    this.eventBus.on(EVENTS.SHARD_TRACE_FIRED, (data) => {
      const item = game.items?.get(data.itemId);
      this.showShardTrace({ itemName: item?.name || 'Unknown' });
    });

    this.eventBus.on(EVENTS.SHARD_INTEGRITY_BRICKED, (data) => {
      const item = game.items?.get(data.itemId);
      this.showShardBricked({ itemName: item?.name || 'Unknown' });
    });

    this.eventBus.on(EVENTS.SHARD_EXPIRED, (data) => {
      const item = game.items?.get(data.itemId);
      this.showShardExpired({ itemName: item?.name || 'Unknown' });
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════

  _escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  destroy() {
    for (const toast of this._toasts) {
      if (toast._dismissTimer) clearTimeout(toast._dismissTimer);
    }
    this._container?.remove();
    this._toasts = [];
  }
}
