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

// Initialize Master Contact Service (GM's contact directory)
moduleInitializer.register('ready', async () => {
  console.log(`${MODULE_ID} | === INITIALIZING MASTER CONTACT SERVICE ===`);
  
  try {
    // Import the service
    const { MasterContactService } = await import('./services/MasterContactService.js');
    
    // Create instance
    console.log(`${MODULE_ID} | Creating MasterContactService...`);
    game.nightcity.masterContactService = new MasterContactService();
    
    // Initialize (loads contacts)
    await game.nightcity.masterContactService.initialize();
    
    // Import and register GM Contact Manager UI
    const { GMContactManagerApp } = await import('./ui/components/GMContactManager/GMContactManagerApp.js');
    game.nightcity.GMContactManagerApp = GMContactManagerApp;
    
    // Verify initialization
    if (!game.nightcity.masterContactService) {
      throw new Error('Failed to initialize masterContactService');
    }
    
    console.log(`${MODULE_ID} | ✓ Master Contact Service initialized`);
    
    // Log stats (GM only)
    if (game.user.isGM) {
      const contacts = game.nightcity.masterContactService.getAllContacts();
      console.log(`${MODULE_ID} | - ${contacts.length} contacts in master list`);
    }
    
  } catch (error) {
    console.error(`${MODULE_ID} | ⚠️ Master Contact Service initialization failed:`, error);
    console.error(`${MODULE_ID} | Stack:`, error.stack);
    // Don't throw - this is non-critical (only affects GM features)
  }
}, 10); // Priority 10 - runs early but after core services

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

// Register Item Inbox service
moduleInitializer.register('init', async () => {
  console.log(`${MODULE_ID} | Initializing Data Shard System...`);
  
  // Register Data Shard Service
  const { DataShardService } = await import('./services/DataShardService.js');
  game.nightcity.dataShardService = new DataShardService();
  
  // Register UI Components
  const { ItemInboxApp } = await import('./ui/components/ItemInbox/ItemInboxApp.js');
  const { ItemInboxConfig } = await import('./ui/components/ItemInbox/ItemInboxConfig.js');
  
  // Make available globally for macros
  game.nightcity.ItemInboxApp = ItemInboxApp;
  game.nightcity.ItemInboxConfig = ItemInboxConfig;
  
  console.log(`${MODULE_ID} | ✓ Data Shard System initialized`);
}, 45);

// Register helper classes for chat messages and dialogs
moduleInitializer.register('init', async () => {
  console.log(`${MODULE_ID} | Registering UI Helpers...`);
  
  // Import helper classes
  const { CyberpunkChatHelper } = await import('./ui/helpers/CyberpunkChatHelper.js');
  const { DialogHelper } = await import('./ui/helpers/DialogHelper.js');
  
  // Make available globally
  game.nightcity.CyberpunkChatHelper = CyberpunkChatHelper;
  game.nightcity.DialogHelper = DialogHelper;
  
  console.log(`${MODULE_ID} | ✓ UI Helpers registered`);
}, 46);

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

// NetworkService Registration - Priority 4 (MUST BE FIRST!)
moduleInitializer.register('ready', async () => {
  console.log(`${MODULE_ID} | === INITIALIZING NETWORK SERVICE ===`);
  
  try {
    const { NetworkService } = await import('./services/NetworkService.js');
    
    const stateManager = game.nightcity.stateManager;
    const eventBus = game.nightcity.eventBus;
    
    if (!stateManager || !eventBus) {
      throw new Error('Dependencies not available');
    }
    
    game.nightcity.networkService = new NetworkService(stateManager, eventBus);
    
    console.log(`${MODULE_ID} | ✓ Network Service initialized`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ NetworkService init failed:`, error);
    throw error;
  }
}, 4); // Priority 4

// Network Manager Registration - Priority 4.5 (AFTER NetworkService!)
moduleInitializer.register('ready', async () => {
  console.log(`${MODULE_ID} | === INITIALIZING NETWORK MANAGER ===`);
  
  try {
    const { NetworkManager } = await import('./core/NetworkManager.js');
    const { NetworkStorage } = await import('./core/NetworkStorage.js');
    const { NetworkUtils } = await import('./utils/NetworkUtils.js');
    
    const networkService = game.nightcity.networkService;  // NOW this exists!
    const stateManager = game.nightcity.stateManager;
    const eventBus = game.nightcity.eventBus;
    
    if (!networkService) {
      throw new Error('NetworkService not available');
    }
    
    const networkManager = new NetworkManager(networkService, stateManager, eventBus);
    await networkManager.initialize();
    
    game.nightcity.networkManager = networkManager;
    game.nightcity.NetworkStorage = NetworkStorage;
    game.nightcity.NetworkUtils = NetworkUtils;
    
    console.log(`${MODULE_ID} | ✓ Network Manager initialized`);
    
  } catch (error) {
    console.error(`${MODULE_ID} | ❌ NetworkManager init failed:`, error);
  }
}, 4.5); // Priority 4.5

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

// Item Sheet Integration
moduleInitializer.register('ready', async () => {
  console.log(`${MODULE_ID} | Setting up Data Shard hooks...`);
  
  // Register context menu option for items
  Hooks.on('getItemDirectoryEntryContext', (html, options) => {
    options.push({
      name: "Configure as Data Shard",
      icon: '<i class="fas fa-microchip"></i>',
      condition: li => {
        const item = game.items.get(li.data('documentId'));
        return item && !item.getFlag(MODULE_ID, 'isDataShard');
      },
      callback: li => {
        const item = game.items.get(li.data('documentId'));
        if (item) {
          const { ItemInboxConfig } = game.nightcity;
          new ItemInboxConfig(item).render(true);
        }
      }
    });
    
    options.push({
      name: "View Data Shard",
      icon: '<i class="fas fa-eye"></i>',
      condition: li => {
        const item = game.items.get(li.data('documentId'));
        return item && item.getFlag(MODULE_ID, 'isDataShard');
      },
      callback: li => {
        const item = game.items.get(li.data('documentId'));
        if (item) {
          const { ItemInboxApp } = game.nightcity;
          new ItemInboxApp(item).render(true);
        }
      }
    });
  });
  
  // Add button to item sheets
  Hooks.on('renderItemSheet', (app, html, data) => {
    const item = app.object;
    const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
    
    if (!isDataShard) return;
    
    // Add "View Messages" button to header
    const $header = html.find('.window-header .window-title');
    
    if ($header.length > 0) {
      const $button = $(`
        <a class="ncm-item-sheet-btn" title="View Data Shard Messages">
          <i class="fas fa-envelope"></i> View Messages
        </a>
      `);
      
      $button.on('click', async (event) => {
        event.preventDefault();
        const { ItemInboxApp } = game.nightcity;
        new ItemInboxApp(item).render(true);
      });
      
      $header.after($button);
    }
    
    // Add styling if not already present
    if (!document.getElementById('ncm-item-sheet-styles')) {
      const style = document.createElement('style');
      style.id = 'ncm-item-sheet-styles';
      style.textContent = `
        .ncm-item-sheet-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 8px;
          margin-left: 10px;
          background: #1a1a1a;
          border: 1px solid #F65261;
          color: #F65261;
          border-radius: 3px;
          cursor: pointer;
          font-size: 0.9em;
          transition: all 0.2s;
        }
        
        .ncm-item-sheet-btn:hover {
          background: #F65261;
          color: #1a1a1a;
        }
      `;
      document.head.appendChild(style);
    }
  });
  
  // Handle chat message buttons for shared data shards
  Hooks.on('renderChatMessage', (message, html, data) => {
    const flags = message.flags[MODULE_ID] || {};
    
    if (!flags.sharedDataShard) return;
    
    // Find and setup "View Data Shard" button
    html.find('.ncm-view-data-shard').off('click').on('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      
      const itemId = $(ev.currentTarget).data('item-id');
      const item = game.items.get(itemId);
      
      if (item) {
        const { ItemInboxApp } = game.nightcity;
        new ItemInboxApp(item).render(true);
      } else {
        ui.notifications.error("Data shard not found");
      }
    });
  });
  
  console.log(`${MODULE_ID} | ✓ Data Shard hooks registered`);
}, 45);

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
    },
    'GM Tools': {
      masterContactService: !!game.nightcity?.masterContactService,
      GMContactManagerApp: !!game.nightcity?.GMContactManagerApp
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