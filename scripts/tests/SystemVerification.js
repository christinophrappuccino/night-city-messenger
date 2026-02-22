/**
 * System Verification
 * @file scripts/tests/SystemVerification.js
 * @module cyberpunkred-messenger
 * @description Post-init health check. Validates all services are present,
 *              settings are registered, and the module is correctly configured.
 *              Run via: game.nightcity.verify()
 */

import { MODULE_ID, THEME_PRESETS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class SystemVerification {
  /**
   * Run full verification suite
   * @returns {{ passed: number, failed: number, results: object[] }}
   */
  static run() {
    const results = [];
    let passed = 0;
    let failed = 0;

    function check(name, condition, detail = '') {
      const ok = !!condition;
      results.push({ name, ok, detail });
      if (ok) passed++;
      else failed++;
    }

    // ─── Core Namespace ───
    check('game.nightcity exists', game.nightcity);
    check('game.nightcity.ready', game.nightcity?.ready === true);

    // ─── Core Singletons ───
    check('EventBus', game.nightcity?.eventBus);
    check('StateManager', game.nightcity?.stateManager);
    check('SettingsManager', game.nightcity?.settingsManager);
    check('SocketManager', game.nightcity?.socketManager);
    check('SocketManager active', game.nightcity?.socketManager?.isActive);

    // ─── Services ───
    check('ThemeService', game.nightcity?.themeService);
    check('SoundService', game.nightcity?.soundService);
    check('TimeService', game.nightcity?.timeService);

    // ─── Settings ───
    const settingsExist = (key) => {
      try { game.settings.get(MODULE_ID, key); return true; }
      catch { return false; }
    };
    check('Setting: playerTheme', settingsExist('playerTheme'));
    check('Setting: customNetworks', settingsExist('customNetworks'));
    check('Setting: scheduledMessages', settingsExist('scheduledMessages'));
    check('Setting: masterContacts', settingsExist('masterContacts'));
    check('Setting: debugMode', settingsExist('debugMode'));

    // ─── Theme ───
    const root = document.documentElement;
    check('CSS --ncm-primary set', root.style.getPropertyValue('--ncm-primary'));
    check('CSS --ncm-bg-base set', root.style.getPropertyValue('--ncm-bg-base'));
    check('Theme presets loaded', Object.keys(THEME_PRESETS).length >= 8);
    check('Animation level attribute', document.body.dataset.ncmAnimationLevel);

    // ─── UI Functions ───
    check('openInbox', typeof game.nightcity?.openInbox === 'function');
    check('composeMessage', typeof game.nightcity?.composeMessage === 'function');
    check('openContacts', typeof game.nightcity?.openContacts === 'function');
    check('openAdmin', typeof game.nightcity?.openAdmin === 'function');

    // ─── EventBus Health ───
    const eb = game.nightcity?.eventBus;
    if (eb) {
      check('EventBus no orphan listeners', eb.listenerCount < 100,
        `${eb.listenerCount} listeners`);
    }

    // ─── Output ───
    console.group(`%c${MODULE_ID} System Verification`, 'font-weight:bold;font-size:14px');
    for (const r of results) {
      const icon = r.ok ? '✅' : '❌';
      const detail = r.detail ? ` (${r.detail})` : '';
      console.log(`  ${icon} ${r.name}${detail}`);
    }
    console.log(`\n  Result: ${passed} passed, ${failed} failed`);
    console.groupEnd();

    return { passed, failed, results };
  }
}
