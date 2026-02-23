/**
 * Phase 2 System Verification
 * @file scripts/tests/Phase2Verification.js
 * @module cyberpunkred-messenger
 * @description Verifies all Phase 2 messaging components are properly initialized.
 *              Run via: game.nightcity.verifyPhase2()
 */

import { MODULE_ID, EVENTS, SOCKET_OPS, TEMPLATES } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class Phase2Verification {

  static async run() {
    const results = [];
    const ns = game.nightcity;

    log.info('╔══════════════════════════════════════════╗');
    log.info('║   Phase 2 Verification — Messaging       ║');
    log.info('╚══════════════════════════════════════════╝');

    // ─── Data Layer ───
    results.push(this._check('MessageRepository exists', () => ns.messageRepository != null));
    results.push(this._check('ContactRepository exists', () => ns.contactRepository != null));
    results.push(this._check('MessageRepository has createMessage()', () => typeof ns.messageRepository?.createMessage === 'function'));
    results.push(this._check('ContactRepository has getContacts()', () => typeof ns.contactRepository?.getContacts === 'function'));

    // ─── Services ───
    results.push(this._check('MessageService exists', () => ns.messageService != null));
    results.push(this._check('NotificationService exists', () => ns.notificationService != null));
    results.push(this._check('MessageService has sendMessage()', () => typeof ns.messageService?.sendMessage === 'function'));
    results.push(this._check('MessageService has getMessages()', () => typeof ns.messageService?.getMessages === 'function'));
    results.push(this._check('MessageService has flushQueue()', () => typeof ns.messageService?.flushQueue === 'function'));
    results.push(this._check('NotificationService has showMessageNotification()', () => typeof ns.notificationService?.showMessageNotification === 'function'));
    results.push(this._check('NotificationService has refreshBadge()', () => typeof ns.notificationService?.refreshBadge === 'function'));

    // ─── Socket Handlers ───
    results.push(this._check('SocketManager has MESSAGE_RELAY handler', () => {
      return ns.socketManager?._handlers?.has(SOCKET_OPS.MESSAGE_RELAY);
    }));
    results.push(this._check('SocketManager has MESSAGE_NOTIFY handler', () => {
      return ns.socketManager?._handlers?.has(SOCKET_OPS.MESSAGE_NOTIFY);
    }));
    results.push(this._check('SocketManager has MESSAGE_DELIVERED handler', () => {
      return ns.socketManager?._handlers?.has(SOCKET_OPS.MESSAGE_DELIVERED);
    }));
    results.push(this._check('SocketManager has MESSAGE_STATUS_UPDATE handler', () => {
      return ns.socketManager?._handlers?.has(SOCKET_OPS.MESSAGE_STATUS_UPDATE);
    }));
    results.push(this._check('SocketManager has INBOX_REFRESH handler', () => {
      return ns.socketManager?._handlers?.has(SOCKET_OPS.INBOX_REFRESH);
    }));

    // ─── UI Launch Functions (not stubs) ───
    results.push(this._check('openInbox() is real (not stub)', () => {
      const fn = ns.openInbox;
      return typeof fn === 'function' && !fn.toString().includes('Phase 2');
    }));
    results.push(this._check('composeMessage() is real (not stub)', () => {
      const fn = ns.composeMessage;
      return typeof fn === 'function' && !fn.toString().includes('Phase 2');
    }));
    results.push(this._check('openContacts() is real (not stub)', () => {
      const fn = ns.openContacts;
      return typeof fn === 'function' && !fn.toString().includes('Phase 2');
    }));

    // ─── Constants ───
    results.push(this._check('EVENTS.INBOX_REFRESH exists', () => EVENTS.INBOX_REFRESH != null));
    results.push(this._check('EVENTS.MESSAGE_STATUS_CHANGED exists', () => EVENTS.MESSAGE_STATUS_CHANGED != null));
    results.push(this._check('EVENTS.QUEUE_FLUSHED exists', () => EVENTS.QUEUE_FLUSHED != null));

    // ─── Templates exist on disk ───
    results.push(await this._checkAsync('message-viewer template loadable', async () => {
      try {
        const html = await renderTemplate(TEMPLATES.MESSAGE_VIEWER, {});
        return html.length > 0;
      } catch { return false; }
    }));
    results.push(await this._checkAsync('message-composer template loadable', async () => {
      try {
        const html = await renderTemplate(TEMPLATES.MESSAGE_COMPOSER, {});
        return html.length > 0;
      } catch { return false; }
    }));
    results.push(await this._checkAsync('contact-manager template loadable', async () => {
      try {
        const html = await renderTemplate(TEMPLATES.CONTACT_MANAGER, {});
        return html.length > 0;
      } catch { return false; }
    }));
    results.push(await this._checkAsync('message-card chat template loadable', async () => {
      try {
        const html = await renderTemplate(TEMPLATES.MESSAGE_CARD, {});
        return html.length > 0;
      } catch { return false; }
    }));

    // ─── Summary ───
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    const total = results.length;

    log.info('─────────────────────────────────────────');
    results.forEach(r => {
      const icon = r.pass ? '✅' : '❌';
      const method = r.pass ? 'info' : 'error';
      log[method](`  ${icon} ${r.name}`);
    });
    log.info('─────────────────────────────────────────');
    log.info(`Phase 2 Verification: ${passed}/${total} passed, ${failed} failed`);

    if (failed === 0) {
      log.info('🎉 All Phase 2 checks PASSED');
      ui.notifications.info(`NCM Phase 2: All ${total} checks passed ✅`);
    } else {
      log.error(`⚠️ ${failed} Phase 2 checks FAILED`);
      ui.notifications.warn(`NCM Phase 2: ${failed}/${total} checks failed`);
    }

    return { passed, failed, total, results };
  }

  /**
   * Run a synchronous check
   * @param {string} name
   * @param {Function} fn - Returns boolean
   * @returns {{name: string, pass: boolean}}
   */
  static _check(name, fn) {
    try {
      return { name, pass: !!fn() };
    } catch {
      return { name, pass: false };
    }
  }

  /**
   * Run an async check
   * @param {string} name
   * @param {Function} fn - Returns Promise<boolean>
   * @returns {Promise<{name: string, pass: boolean}>}
   */
  static async _checkAsync(name, fn) {
    try {
      return { name, pass: !!(await fn()) };
    } catch {
      return { name, pass: false };
    }
  }
}
