/**
 * Night City Messenger — Entry Point
 * @file scripts/main.js
 * @module cyberpunkred-messenger
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
import { registerIntegrations } from './init/registerIntegrations.js';
import { registerGMTools } from './init/registerGMTools.js';
import { registerReadyServices } from './init/registerReadyServices.js';
import { SystemVerification } from './tests/SystemVerification.js';

const initializer = new ModuleInitializer();

// ─── Register all tasks ───
registerCoreServices(initializer);
registerTemplates(initializer);
registerUIComponents(initializer);
registerMessagingSystem(initializer);      // Phase 2: Messaging
registerNetworkSystem(initializer);
registerDataShardSystem(initializer);
registerIntegrations(initializer);
registerReadyServices(initializer);
registerGMTools(initializer);  

// ─── Foundry Hooks ───

Hooks.once('init', async () => {
  log.info('Initializing Night City Messenger v4.1...');
  await initializer.runPhase('preInit');
  await initializer.runPhase('init');
});

Hooks.once('ready', async () => {
  await initializer.runPhase('ready');

  // postReady with 100ms delay to let Foundry settle
  setTimeout(async () => {
    await initializer.runPhase('postReady');

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
