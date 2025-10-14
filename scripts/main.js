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

// Register time settings
moduleInitializer.register('init', async () => {
  console.log(`${MODULE_ID} | Initializing Time System...`);
  const { TimeService } = await import('./services/TimeService.js');
  TimeService.getInstance();
  console.log(`${MODULE_ID} | ✓ Time System initialized`);
}, 40);

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

// Initialize core services FIRST
moduleInitializer.register('ready', async () => {
  console.log(`${MODULE_ID} | === INITIALIZING CORE SERVICES ===`);
  
  try {
    const { MessageService } = await import('./services/MessageService.js');
    const { NotificationService } = await import('./services/NotificationService.js');
    
    console.log(`${MODULE_ID} | Creating MessageService...`);
    game.nightcity.messageService = new MessageService();
    
    console.log(`${MODULE_ID} | Creating NotificationService...`);
    game.nightcity.notificationService = new NotificationService();
    
    // Alias for backwards compatibility
    game.nightcity.messageManager = game.nightcity.messageService;
    
    // Verify they exist
    if (!game.nightcity.messageManager) {
      throw new Error('Failed to initialize messageManager');
    }
    if (!game.nightcity.messageService) {
      throw new Error('Failed to initialize messageService');
    }
    if (!game.nightcity.notificationService) {
      throw new Error('Failed to initialize notificationService');
    }
    
    console.log(`${MODULE_ID} | ✓ Core services initialized successfully`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ FAILED to initialize core services:`, error);
    console.error(`${MODULE_ID} | Stack:`, error.stack);
    ui.notifications.error('Failed to initialize core services. Check console.');
    throw error; // Re-throw to prevent further initialization
  }
}, 3); 

// Time Service Registration SECOND
moduleInitializer.register('ready', async () => {
  console.log(`${MODULE_ID} | === INITIALIZING TIME SERVICE ===`);
  
  try {
    const { TimeService } = await import('./services/TimeService.js');
    const timeService = TimeService.getInstance();
    game.nightcity.timeService = timeService;
    
    if (!game.nightcity.timeService) {
      throw new Error('Failed to initialize timeService');
    }
    
    console.log(`${MODULE_ID} | ✓ Time Service ready`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ FAILED to initialize time service:`, error);
    console.error(`${MODULE_ID} | Stack:`, error.stack);
    ui.notifications.error('Failed to initialize time service. Check console.');
    throw error;
  }
}, 4);

// Complete macro API registration THIRD
moduleInitializer.register('ready', async () => {
  console.log(`${MODULE_ID} | === REGISTERING MACRO API ===`);
  
  try {
    const { MacroAPI } = await import('./integrations/MacroAPI.js');
    MacroAPI.registerServices();
    console.log(`${MODULE_ID} | ✓ Macro API registered`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | ⚠️ Macro API registration failed:`, error);
    // Don't throw - this is non-critical
  }
}, 5);

// Start scheduling service FOURTH - ONLY after dependencies are ready
moduleInitializer.register('ready', async () => {
  console.log(`${MODULE_ID} | === INITIALIZING SCHEDULING SERVICE ===`);
  
  try {
    // Verify ALL dependencies exist
    console.log(`${MODULE_ID} | Checking dependencies...`);
    
    if (!game.nightcity) {
      throw new Error('game.nightcity namespace not initialized');
    }
    
    if (!game.nightcity.messageManager) {
      throw new Error('messageManager not available - cannot initialize scheduling');
    }
    
    if (!game.nightcity.timeService) {
      throw new Error('timeService not available - cannot initialize scheduling');
    }
    
    console.log(`${MODULE_ID} | ✓ Dependencies verified`);
    console.log(`${MODULE_ID} | - messageManager: ${!!game.nightcity.messageManager}`);
    console.log(`${MODULE_ID} | - timeService: ${!!game.nightcity.timeService}`);
    
    // Import and create
    console.log(`${MODULE_ID} | Importing SchedulingService...`);
    const { SchedulingService } = await import('./services/SchedulingService.js');
    
    console.log(`${MODULE_ID} | Creating SchedulingService instance...`);
    const schedulingService = new SchedulingService();
    
    // Assign to namespace
    console.log(`${MODULE_ID} | Assigning to game.nightcity...`);
    game.nightcity.schedulingService = schedulingService;
    
    // Verify assignment
    if (!game.nightcity.schedulingService) {
      throw new Error('Failed to assign schedulingService to game.nightcity');
    }
    
    console.log(`${MODULE_ID} | ✓ SchedulingService instance created`);
    
    // Only start automatic checking for GM
    if (game.user.isGM) {
      console.log(`${MODULE_ID} | Starting automatic schedule checking (GM mode)...`);
      schedulingService.start();
      console.log(`${MODULE_ID} | ✓ Scheduling service started (GM mode)`);
    } else {
      console.log(`${MODULE_ID} | ✓ Scheduling service available (player mode)`);
    }
    
    console.log(`${MODULE_ID} | === SCHEDULING SERVICE READY ===`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ FAILED TO INITIALIZE SCHEDULING SERVICE:`, error);
    console.error(`${MODULE_ID} | Error name:`, error.name);
    console.error(`${MODULE_ID} | Error message:`, error.message);
    console.error(`${MODULE_ID} | Stack:`, error.stack);
    
    // Store error for better user feedback
    game.nightcity = game.nightcity || {};
    game.nightcity.schedulingServiceError = error.message;
    
    ui.notifications.error(`Scheduling service failed to initialize: ${error.message}`);
    
    // Don't throw - allow module to continue working without scheduling
    console.warn(`${MODULE_ID} | Module will continue without scheduling functionality`);
  }
}, 10);

// Register socket handlers
moduleInitializer.register('ready', async () => {
  console.log(`${MODULE_ID} | === INITIALIZING SOCKET HANDLERS ===`);
  
  try {
    const { registerSocketHandlers } = await import('./integrations/SocketHandlers.js');
    registerSocketHandlers();
    console.log(`${MODULE_ID} | ✓ Socket handlers registered`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | ⚠️ Socket handler registration failed:`, error);
    // Don't throw - this is non-critical
  }
}, 20);

// Register email auto-prompts
moduleInitializer.register('ready', async () => {
  console.log(`${MODULE_ID} | === REGISTERING EMAIL PROMPTS ===`);
  
  try {
    const { registerEmailPrompts } = await import('./integrations/EmailSettingsRegistration.js');
    registerEmailPrompts();
    console.log(`${MODULE_ID} | ✓ Email prompts registered`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | ⚠️ Email prompt registration failed:`, error);
    // Don't throw - this is non-critical
  }
}, 25);

// ===================================================================
// POST-READY
// ===================================================================

// Verify system health and log all services
moduleInitializer.register('postReady', async () => {
  console.log(`${MODULE_ID} | === VERIFYING SYSTEM ===`);
  
  const services = {
    'Core Services': {
      messageManager: !!game.nightcity?.messageManager,
      messageService: !!game.nightcity?.messageService,
      notificationService: !!game.nightcity?.notificationService
    },
    'Timing': {
      timeService: !!game.nightcity?.timeService
    },
    'Scheduling': {
      schedulingService: !!game.nightcity?.schedulingService
    }
  };
  
  console.log(`${MODULE_ID} | Service Status:`);
  for (const [category, categoryServices] of Object.entries(services)) {
    console.log(`${MODULE_ID} | ${category}:`);
    for (const [name, available] of Object.entries(categoryServices)) {
      const status = available ? '✓' : '✗';
      console.log(`${MODULE_ID} |   ${status} ${name}: ${available}`);
    }
  }
  
  // Check for critical failures
  const criticalServices = [
    'messageManager',
    'messageService',
    'notificationService',
    'timeService'
  ];
  
  const missingCritical = criticalServices.filter(
    service => !game.nightcity?.[service]
  );
  
  if (missingCritical.length > 0) {
    console.error(`${MODULE_ID} | ❌ CRITICAL SERVICES MISSING:`, missingCritical);
    ui.notifications.error(
      `Night City Messenger: Critical services missing (${missingCritical.join(', ')}). Module may not function correctly.`
    );
  } else {
    console.log(`${MODULE_ID} | ✅ All critical services initialized`);
  }
  
  // Warn about optional services
  if (!game.nightcity?.schedulingService) {
    console.warn(`${MODULE_ID} | ⚠️ Scheduling service unavailable - scheduled messages will not work`);
    if (game.nightcity?.schedulingServiceError) {
      console.warn(`${MODULE_ID} | Reason: ${game.nightcity.schedulingServiceError}`);
    }
  }
  
  // Run full system verification
  try {
    const { SystemVerification } = await import('./utils/SystemVerification.js');
    await SystemVerification.run();
  } catch (error) {
    console.error(`${MODULE_ID} | System verification failed:`, error);
  }
  
  console.log(`${MODULE_ID} | === VERIFICATION COMPLETE ===`);
}, 10);

// Mark as ready
moduleInitializer.register('postReady', () => {
  game.nightcity.ready = true;
  
  console.log(`${MODULE_ID} | ========================================`);
  console.log(`${MODULE_ID} | 🌃 Night City Messenger is READY!`);
  console.log(`${MODULE_ID} | API: game.nightcity`);
  console.log(`${MODULE_ID} | ========================================`);
  
  if (game.user.isGM) {
    // Show ready notification
    ui.notifications.info('Night City Messenger: System initialized');
  }
}, 100);

// ===================================================================
// FOUNDRY HOOKS
// ===================================================================

/**
 * Pre-initialization
 */
Hooks.once('init', async () => {
  console.log(`${MODULE_ID} | ======================================`);
  console.log(`${MODULE_ID} | 🌃 NIGHT CITY MESSENGER`);
  console.log(`${MODULE_ID} | Initializing...`);
  console.log(`${MODULE_ID} | ======================================`);
  
  try {
    await moduleInitializer.runPreInit();
    await moduleInitializer.runInit();
    console.log(`${MODULE_ID} | ✓ Init phase complete`);
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ Initialization failed:`, error);
    console.error(`${MODULE_ID} | Stack:`, error.stack);
    ui.notifications.error(`Night City Messenger: Initialization failed. Check console for details.`);
  }
});

/**
 * Ready
 */
Hooks.once('ready', async () => {
  console.log(`${MODULE_ID} | ======================================`);
  console.log(`${MODULE_ID} | Activating module...`);
  console.log(`${MODULE_ID} | ======================================`);
  
  try {
    await moduleInitializer.runReady();
    console.log(`${MODULE_ID} | ✓ Ready phase complete`);
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ Ready phase failed:`, error);
    console.error(`${MODULE_ID} | Stack:`, error.stack);
    ui.notifications.error(`Night City Messenger: Ready phase failed. Check console for details.`);
  }
});