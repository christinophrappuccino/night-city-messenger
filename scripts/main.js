/**
 * Night City Messenger - Main Entry Point
 * File: scripts/main.js
 * Module: cyberpunkred-messenger
 * Description: Single entry point that orchestrates all systems
 */

import { MODULE_ID } from './utils/constants.js';
import { moduleInitializer } from './core/ModuleInitializer.js';

console.log(`${MODULE_ID} | Loading module...`);

// ===================================================================
// EARLY INITIALIZATION - Set up namespace immediately
// ===================================================================

// Initialize game.nightcity namespace immediately
game.nightcity = game.nightcity || {};
game.nightcity.ready = false;

console.log(`${MODULE_ID} | Namespace initialized`);

// ===================================================================
// PRE-INITIALIZATION
// ===================================================================

// Register template loading
moduleInitializer.register('preInit', async () => {
  const { TemplateManager } = await import('./ui/helpers/TemplateManager.js');
  await TemplateManager.preloadTemplates();
}, 10);

// Register Handlebars helpers
moduleInitializer.register('preInit', async () => {
  const { HandlebarsHelpers } = await import('./ui/helpers/HandlebarsHelpers.js');
  HandlebarsHelpers.register();
}, 20);

// ===================================================================
// INITIALIZATION
// ===================================================================

// Register macro API early (before ready)
moduleInitializer.register('init', async () => {
  const { MacroAPI } = await import('./integrations/MacroAPI.js');
  MacroAPI.registerEarly();
}, 5);

// Register UI components
moduleInitializer.register('init', async () => {
  const { registerUIComponents } = await import('./integrations/UIRegistry.js');
  registerUIComponents();
}, 10);

// Register chat integration
moduleInitializer.register('init', async () => {
  const { registerChatIntegration } = await import('./integrations/ChatIntegration.js');
  registerChatIntegration();
}, 20);

// Register item sheet integration
moduleInitializer.register('init', async () => {
  const { registerItemSheetHooks } = await import('./integrations/ItemSheetIntegration.js');
  registerItemSheetHooks();
}, 30);

// Register email settings
moduleInitializer.register('init', async () => {
  const { registerEmailSettings, registerActorSheetHooks } = await import('./integrations/EmailSettingsRegistration.js');
  registerEmailSettings();
  registerActorSheetHooks();
}, 35);


// ===================================================================
// READY
// ===================================================================

// Complete macro API registration
moduleInitializer.register('ready', async () => {
  const { MacroAPI } = await import('./integrations/MacroAPI.js');
  MacroAPI.registerServices();
}, 5);

// Start scheduling service
moduleInitializer.register('ready', async () => {
  const { SchedulingService } = await import('./services/SchedulingService.js');
  const schedulingService = new SchedulingService();
  
  if (game.user.isGM) {
    schedulingService.start();
  }
  
  game.nightcity.schedulingService = schedulingService;
}, 10);

// Register socket handlers
moduleInitializer.register('ready', async () => {
  const { registerSocketHandlers } = await import('./integrations/SocketHandlers.js');
  registerSocketHandlers();
}, 20);

// Register email auto-prompts (add after line ~70, with other ready tasks)
moduleInitializer.register('ready', async () => {
  const { registerEmailPrompts } = await import('./integrations/EmailSettingsRegistration.js');
  registerEmailPrompts();
}, 25);

// ===================================================================
// POST-READY
// ===================================================================

// Verify system health
moduleInitializer.register('postReady', async () => {
  const { SystemVerification } = await import('./utils/SystemVerification.js');
  await SystemVerification.run();
}, 10);

// Mark as ready
moduleInitializer.register('postReady', () => {
  game.nightcity.ready = true;
  
  if (game.user.isGM) {
    console.log(`${MODULE_ID} | ========================================`);
    console.log(`${MODULE_ID} | Night City Messenger is ready!`);
    console.log(`${MODULE_ID} | Use 'game.nightcity' to access the API`);
    console.log(`${MODULE_ID} | ========================================`);
  }
}, 100);

// ===================================================================
// FOUNDRY HOOKS
// ===================================================================

/**
 * Pre-initialization
 */
Hooks.once('init', async () => {
  console.log(`${MODULE_ID} | Initializing...`);
  
  try {
    await moduleInitializer.runPreInit();
    await moduleInitializer.runInit();
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ Initialization failed:`, error);
    ui.notifications.error(`${MODULE_ID} initialization failed. Check console for details.`);
  }
});

/**
 * Ready
 */
Hooks.once('ready', async () => {
  console.log(`${MODULE_ID} | Activating...`);
  
  try {
    await moduleInitializer.runReady();
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ Ready phase failed:`, error);
    ui.notifications.error(`${MODULE_ID} ready phase failed. Check console for details.`);
  }
});