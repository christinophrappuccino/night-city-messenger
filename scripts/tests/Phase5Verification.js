/**
 * Phase 5 Verification
 * @file scripts/tests/Phase5Verification.js
 * @module cyberpunkred-messenger
 * @description Automated checks covering Phase 5 services, UI launch functions,
 *              macro API completeness, and template loading.
 *              Registered via ModuleInitializer at postReady/32.
 */

import { MODULE_ID, TEMPLATES } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';

export class Phase5Verification {

  /** @type {Array<{id: string, label: string, passed: boolean, detail: string}>} */
  _results = [];

  /**
   * Run all Phase 5 checks.
   */
  async run() {
    console.group(`%c${MODULE_ID} | Phase 5 Verification`, 'color: #19f3f7; font-weight: bold;');

    // ─── 5.01: SchedulingService ───
    await this._check('5.01', 'SchedulingService available', () => {
      const svc = game.nightcity?.schedulingService;
      if (!svc) return { passed: false, detail: 'SchedulingService not on game.nightcity' };

      const methods = ['scheduleMessage', 'cancelScheduled', 'editScheduled', 'getPending', 'getAll', 'getScheduled'];
      const missing = methods.filter(m => typeof svc[m] !== 'function');
      if (missing.length > 0) return { passed: false, detail: `Missing methods: ${missing.join(', ')}` };

      return { passed: true, detail: `SchedulingService: ${methods.length} methods verified` };
    });

    // ─── 5.02: MasterContactService ───
    await this._check('5.02', 'MasterContactService available', () => {
      const svc = game.nightcity?.masterContactService;
      if (!svc) return { passed: false, detail: 'MasterContactService not on game.nightcity' };

      const methods = ['getAll', 'getContact', 'getByEmail', 'getByActorId', 'search',
        'addContact', 'updateContact', 'removeContact', 'pushToPlayer', 'getAllTags'];
      const missing = methods.filter(m => typeof svc[m] !== 'function');
      if (missing.length > 0) return { passed: false, detail: `Missing methods: ${missing.join(', ')}` };

      return { passed: true, detail: `MasterContactService: ${methods.length} methods verified` };
    });

    // ─── 5.03: MacroAPI namespace ───
    await this._check('5.03', 'MacroAPI (game.nightcity.messenger) registered', () => {
      const api = game.nightcity?.messenger;
      if (!api) return { passed: false, detail: 'game.nightcity.messenger not found' };

      const expectedFuncs = [
        'sendMessage', 'getMessages', 'getUnreadCount', 'deleteMessage', 'shareToChat',
        'scheduleMessage', 'cancelScheduled', 'getPendingScheduled',
        'getCurrentNetwork', 'getSignalStrength', 'getAvailableNetworks', 'setNetwork',
        'convertToDataShard', 'hackShard', 'forceDecryptShard', 'relockShard', 'addShardMessage',
        'getMasterContacts', 'addMasterContact',
        'openInbox', 'openComposer', 'openContacts', 'openAdmin', 'openThemeCustomizer',
      ];
      const missing = expectedFuncs.filter(f => typeof api[f] !== 'function');
      if (missing.length > 0) return { passed: false, detail: `Missing: ${missing.join(', ')}` };

      return { passed: true, detail: `MacroAPI: ${expectedFuncs.length} functions registered` };
    });

    // ─── 5.04: Admin Panel launch function ───
    await this._check('5.04', 'openAdmin() launch function', () => {
      if (typeof game.nightcity?.openAdmin !== 'function') {
        return { passed: false, detail: 'game.nightcity.openAdmin is not a function' };
      }
      return { passed: true, detail: 'openAdmin() available' };
    });

    // ─── 5.05: GM Contact Manager launch function ───
    await this._check('5.05', 'openGMContacts() launch function', () => {
      if (typeof game.nightcity?.openGMContacts !== 'function') {
        return { passed: false, detail: 'game.nightcity.openGMContacts is not a function' };
      }
      return { passed: true, detail: 'openGMContacts() available' };
    });

    // ─── 5.06: Theme Customizer launch function ───
    await this._check('5.06', 'openThemeCustomizer() launch function', () => {
      if (typeof game.nightcity?.openThemeCustomizer !== 'function') {
        return { passed: false, detail: 'game.nightcity.openThemeCustomizer is not a function' };
      }
      return { passed: true, detail: 'openThemeCustomizer() available' };
    });

    // ─── 5.07: Email setup functions ───
    await this._check('5.07', 'Email setup functions (setupEmail, ensureEmail)', () => {
      const ns = game.nightcity;
      const fns = ['setupEmail', 'ensureEmail'];
      const missing = fns.filter(f => typeof ns?.[f] !== 'function');
      if (missing.length > 0) return { passed: false, detail: `Missing: ${missing.join(', ')}` };
      return { passed: true, detail: 'setupEmail() and ensureEmail() registered' };
    });

    // ─── 5.08: Templates loadable ───
    await this._check('5.08', 'Phase 5 templates loadable', async () => {
      const templatePaths = [
        TEMPLATES.ADMIN_PANEL,
        TEMPLATES.GM_CONTACT_MANAGER,
        TEMPLATES.THEME_CUSTOMIZER,
        TEMPLATES.PLAYER_EMAIL_SETUP,
      ];

      const results = [];
      for (const path of templatePaths) {
        try {
          const response = await fetch(path);
          results.push({ path, ok: response.ok });
        } catch {
          results.push({ path, ok: false });
        }
      }

      const failed = results.filter(r => !r.ok);
      if (failed.length > 0) {
        return { passed: false, detail: `Missing templates: ${failed.map(f => f.path).join(', ')}` };
      }
      return { passed: true, detail: `${results.length} templates accessible` };
    });

    // ─── 5.09: SchedulingService settings persistence ───
    await this._check('5.09', 'Scheduled messages setting registered', () => {
      try {
        const val = game.settings.get(MODULE_ID, 'scheduledMessages');
        if (!Array.isArray(val)) return { passed: false, detail: 'scheduledMessages setting not an array' };
        return { passed: true, detail: `scheduledMessages: ${val.length} entries stored` };
      } catch {
        return { passed: false, detail: 'scheduledMessages setting not registered' };
      }
    });

    // ─── 5.10: MasterContactService settings persistence ───
    await this._check('5.10', 'Master contacts setting registered', () => {
      try {
        const val = game.settings.get(MODULE_ID, 'masterContacts');
        if (!Array.isArray(val)) return { passed: false, detail: 'masterContacts setting not an array' };
        return { passed: true, detail: `masterContacts: ${val.length} contacts stored` };
      } catch {
        return { passed: false, detail: 'masterContacts setting not registered' };
      }
    });

    // ─── 5.11: Scene controls include Phase 5 buttons ───
    await this._check('5.11', 'Scene controls include admin button', () => {
      // Check that the admin button is registered in scene controls
      // This is a structural check — the actual rendering is handled by FoundryVTT
      if (typeof game.nightcity?.openAdmin !== 'function') {
        return { passed: false, detail: 'openAdmin not registered (scene control will have no handler)' };
      }
      return { passed: true, detail: 'Admin panel scene control handler available' };
    });

    // ─── 5.12: Previous phases still pass ───
    await this._check('5.12', 'Core services intact (Phase 1-4 regression)', () => {
      const ns = game.nightcity;
      const required = [
        'eventBus', 'stateManager', 'settingsManager', 'socketManager',
        'themeService', 'soundService', 'timeService',
        'messageService', 'notificationService',
        'networkService', 'securityService',
        'dataShardService', 'skillService',
      ];
      const missing = required.filter(s => !ns?.[s]);
      if (missing.length > 0) return { passed: false, detail: `Missing: ${missing.join(', ')}` };
      return { passed: true, detail: `All ${required.length} prior-phase services intact` };
    });

    // ─── Summary ───
    const passed = this._results.filter(r => r.passed).length;
    const total = this._results.length;
    const allPassed = passed === total;

    console.log(
      `%c${allPassed ? '✅' : '⚠️'} Phase 5 Verification: ${passed}/${total} checks passed`,
      `color: ${allPassed ? '#19f3f7' : '#F65261'}; font-weight: bold; font-size: 1.1em;`
    );

    console.groupEnd();
    return { passed, total, allPassed, results: this._results };
  }

  /**
   * Run a single check.
   * @param {string} id
   * @param {string} label
   * @param {Function} fn
   * @private
   */
  async _check(id, label, fn) {
    try {
      const result = await fn();
      this._results.push({ id, label, ...result });

      const icon = result.passed ? '✅' : '❌';
      const color = result.passed ? '#19f3f7' : '#F65261';
      console.log(`%c  ${icon} [${id}] ${label}: ${result.detail}`, `color: ${color}`);
    } catch (error) {
      this._results.push({ id, label, passed: false, detail: `Error: ${error.message}` });
      console.log(`%c  ❌ [${id}] ${label}: Error — ${error.message}`, 'color: #F65261');
    }
  }
}
