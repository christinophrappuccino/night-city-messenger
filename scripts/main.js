/**
 * Night City Messenger — Entry Point
 * @file scripts/main.js
 * @module night-city-messenger
 * @description Clean entry point. Delegates all initialization to
 *              ModuleInitializer and the init/ registration files.
 */

import { MODULE_ID } from './utils/constants.js';
import { log } from './utils/helpers.js';
import { ModuleInitializer } from './core/ModuleInitializer.js';
import { registerCoreServices } from './init/registerCoreServices.js';
import { registerTemplates } from './init/registerTemplates.js';
import { registerUIComponents } from './init/registerUIComponents.js';
import { registerMessagingSystem } from './init/registerMessagingSystem.js';
import { registerNetworkSystem } from './init/registerNetworkSystem.js';
import { registerDataShardSystem } from './init/registerDataShardSystem.js';
import { registerTerminalSystem } from './init/registerTerminalSystem.js';
import { registerIntegrations } from './init/registerIntegrations.js';
import { registerGMTools } from './init/registerGMTools.js';
import { registerReadyServices } from './init/registerReadyServices.js';
import { registerCallSystem } from './init/registerCallSystem.js';
import { registerWatchSystem } from './init/registerWatchSystem.js';
import { SystemVerification } from './tests/SystemVerification.js';

const initializer = new ModuleInitializer();

// ─── Register all tasks ───
registerCoreServices(initializer);
registerTemplates(initializer);
registerUIComponents(initializer);
registerMessagingSystem(initializer);      // Phase 2: Messaging
registerNetworkSystem(initializer);
registerDataShardSystem(initializer);
registerTerminalSystem(initializer);
registerCallSystem(initializer);
registerWatchSystem(initializer);
registerIntegrations(initializer);
registerReadyServices(initializer);
registerGMTools(initializer);  

// ─── Foundry Hooks ───

/** Settles when every preInit + init task has (the template preload included). Ready waits for it (audit FBL-07). */
let initDone = Promise.resolve();

// Everything synchronous registers inside Foundry's init hook — nothing waits on the network first (audit COMPAT-01).
// Foundry does not await an async init callback, so anything after an `await` here used to land after init had
// ended: on a slow host the keybindings threw and settings were missing when ready tasks read them.
Hooks.once('init', () => {
  // the real version, from module.json (audit ARCH-03: it printed a fixed, out-of-date number)
  log.info(`Initializing Night City Messenger v${game.modules?.get?.(MODULE_ID)?.version || '?'}...`);
  const preInit = initializer.runPhaseNow('preInit');
  const init = initializer.runPhaseNow('init');
  initDone = Promise.all([preInit, init]);
});

Hooks.once('ready', async () => {
  await initDone;
  await initializer.runPhase('ready');

  // postReady with 100ms delay to let Foundry settle
  setTimeout(async () => {
    await initializer.runPhase('postReady');
    initializer.reportFailures();   // the GM hears about a failed startup step (ARCH-02)
    if (game.nightcity) game.nightcity.startupFailures = initializer.failures;
    if (game.nightcity) game.nightcity.startupReport = initializer.report;   // { failed, missing, affected } (serviceMap.js)

    // Register verification function
    if (game.nightcity) {
      game.nightcity.verify = () => SystemVerification.run();
    }

    // Auto-verify in debug mode
    try {
      if (game.settings.get(MODULE_ID, 'debugMode')) {
        SystemVerification.run();
      }
    } catch {
      // Setting may not be registered if init failed
    }
  }, 100);
});
