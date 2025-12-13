/**
 * Network System Diagnostics
 * File: scripts/diagnostics/networkDiagnostics.js
 * Module: cyberpunkred-messenger
 * 
 * Run these in the browser console to diagnose network sync issues:
 * 
 * game.nightcity.diagnostics.checkNetworkSync()
 * game.nightcity.diagnostics.listSceneNetworks()
 * game.nightcity.diagnostics.testSceneNetworkToggle('CITINET', true)
 */

const MODULE_ID = 'cyberpunkred-messenger';

export const networkDiagnostics = {
  
  /**
   * Full diagnostic check of the network system
   */
  async checkNetworkSync() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('NIGHT CITY MESSENGER - NETWORK SYNC DIAGNOSTIC');
    console.log('═══════════════════════════════════════════════════════════');
    
    // 1. Check NetworkManager exists
    console.log('\n1. NetworkManager Status:');
    const nm = game.nightcity?.networkManager;
    if (nm) {
      console.log('   ✓ NetworkManager exists');
      console.log('   Current network:', nm.getNetworkStatus?.()?.networkId || 'None');
    } else {
      console.log('   ✗ NetworkManager NOT FOUND');
      return;
    }
    
    // 2. Check all networks in settings
    console.log('\n2. Networks in Settings:');
    const allNetworks = await game.settings.get(MODULE_ID, 'customNetworks') || [];
    console.log(`   Found ${allNetworks.length} network(s):`);
    allNetworks.forEach(n => {
      console.log(`   - ${n.id}: "${n.name}" (enabled: ${n.enabled})`);
    });
    
    // 3. Check current scene
    console.log('\n3. Current Scene:');
    const scene = canvas.scene;
    if (scene) {
      console.log(`   Scene: ${scene.name} (ID: ${scene.id})`);
      
      // Check scene flags
      const sceneFlags = scene.getFlag(MODULE_ID, 'networks') || {};
      console.log('   Scene network flags:', sceneFlags);
      
      const flagCount = Object.keys(sceneFlags).length;
      console.log(`   Networks configured in scene: ${flagCount}`);
      
      // List each network's availability
      for (const [networkId, config] of Object.entries(sceneFlags)) {
        const network = allNetworks.find(n => n.id === networkId);
        console.log(`   - ${networkId}: available=${config.available}, signal=${config.signalStrength}% ${network ? '' : '(NETWORK NOT FOUND)'}`);
      }
    } else {
      console.log('   ✗ No active scene');
    }
    
    // 4. Check getAvailableNetworks output
    console.log('\n4. getAvailableNetworks() Output:');
    const availableNetworks = await nm.getAvailableNetworks?.() || [];
    console.log(`   Returns ${availableNetworks.length} network(s):`);
    availableNetworks.forEach(n => {
      console.log(`   - ${n.id}: "${n.name}" (signal: ${n.signalStrength}%)`);
    });
    
    // 5. Check for property name issues
    console.log('\n5. Property Name Check:');
    if (scene) {
      const sceneFlags = scene.getFlag(MODULE_ID, 'networks') || {};
      for (const [networkId, config] of Object.entries(sceneFlags)) {
        const hasAvailable = 'available' in config;
        const hasEnabled = 'enabled' in config;
        
        if (hasEnabled && !hasAvailable) {
          console.log(`   ⚠️ ${networkId}: Uses 'enabled' instead of 'available' - NEEDS MIGRATION`);
        } else if (hasAvailable) {
          console.log(`   ✓ ${networkId}: Uses 'available' correctly`);
        }
      }
    }
    
    // 6. Summary
    console.log('\n6. Summary:');
    const inSettings = allNetworks.length;
    const inScene = Object.keys(scene?.getFlag(MODULE_ID, 'networks') || {}).length;
    const available = availableNetworks.length;
    
    console.log(`   Networks in settings: ${inSettings}`);
    console.log(`   Networks configured for this scene: ${inScene}`);
    console.log(`   Networks available (filtered): ${available}`);
    
    if (available === 0 && inSettings > 0) {
      console.log('\n   ⚠️ NO NETWORKS AVAILABLE!');
      console.log('   Possible causes:');
      console.log('   - Scene has no network flags configured');
      console.log('   - All networks have available: false');
      console.log('   - Property name mismatch (enabled vs available)');
    }
    
    console.log('\n═══════════════════════════════════════════════════════════');
  },
  
  /**
   * List all scene network configurations
   */
  async listSceneNetworks() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('SCENE NETWORK CONFIGURATIONS');
    console.log('═══════════════════════════════════════════════════════════');
    
    for (const scene of game.scenes.contents) {
      const flags = scene.getFlag(MODULE_ID, 'networks') || {};
      const flagCount = Object.keys(flags).length;
      const availableCount = Object.values(flags).filter(f => f.available === true).length;
      
      console.log(`\n${scene.active ? '▶' : ' '} ${scene.name}`);
      console.log(`  ID: ${scene.id}`);
      console.log(`  Networks: ${flagCount} configured, ${availableCount} available`);
      
      if (flagCount > 0) {
        for (const [networkId, config] of Object.entries(flags)) {
          const status = config.available ? '✓' : '✗';
          console.log(`    ${status} ${networkId}: signal=${config.signalStrength || '?'}%`);
        }
      }
    }
  },
  
  /**
   * Test toggling a network's availability in the current scene
   */
  async testSceneNetworkToggle(networkId, available) {
    console.log(`Testing: Set ${networkId} available=${available} in current scene`);
    
    const scene = canvas.scene;
    if (!scene) {
      console.log('ERROR: No active scene');
      return;
    }
    
    // Get current flags
    const flags = scene.getFlag(MODULE_ID, 'networks') || {};
    console.log('Before:', flags[networkId]);
    
    // Update
    flags[networkId] = {
      ...(flags[networkId] || {}),
      available: available,
      signalStrength: flags[networkId]?.signalStrength ?? 90
    };
    
    await scene.setFlag(MODULE_ID, 'networks', flags);
    console.log('After:', flags[networkId]);
    
    // Check getAvailableNetworks
    const nm = game.nightcity?.networkManager;
    if (nm) {
      const availableNetworks = await nm.getAvailableNetworks();
      const found = availableNetworks.find(n => n.id === networkId);
      console.log(`Network ${networkId} in getAvailableNetworks: ${found ? 'YES' : 'NO'}`);
    }
    
    return flags[networkId];
  },
  
  /**
   * Fix property names in scene flags (migrate 'enabled' to 'available')
   */
  async migrateSceneFlags() {
    console.log('Migrating scene flags: enabled -> available');
    
    let migratedCount = 0;
    
    for (const scene of game.scenes.contents) {
      const flags = scene.getFlag(MODULE_ID, 'networks') || {};
      let changed = false;
      
      for (const [networkId, config] of Object.entries(flags)) {
        if ('enabled' in config && !('available' in config)) {
          flags[networkId] = {
            ...config,
            available: config.enabled,
          };
          delete flags[networkId].enabled;
          changed = true;
          migratedCount++;
        }
      }
      
      if (changed) {
        await scene.setFlag(MODULE_ID, 'networks', flags);
        console.log(`  Migrated: ${scene.name}`);
      }
    }
    
    console.log(`Migration complete: ${migratedCount} networks updated`);
    return migratedCount;
  },
  
  /**
   * Quick enable CITINET in current scene (for testing)
   */
  async enableCitiNet() {
    return this.testSceneNetworkToggle('CITINET', true);
  },
  
  /**
   * Force refresh all network components
   */
  async forceRefresh() {
    // Rescan networks
    const nm = game.nightcity?.networkManager;
    if (nm?.scanNetworks) {
      await nm.scanNetworks();
    }
    
    // Refresh NetworkSelector
    const selector = game.nightcity?.networkSelectorApp;
    if (selector) {
      selector.cachedNetworks = null;
      selector.cacheTimestamp = 0;
      if (selector.rendered) selector.render(false);
    }
    
    // Refresh any MessageViewers
    for (const app of Object.values(ui.windows)) {
      if (app.constructor.name === 'MessageViewerApp' && app.rendered) {
        app.render(false);
      }
    }
    
    console.log('Force refresh complete');
    ui.notifications.info('Network components refreshed');
  }
};

// Register globally
Hooks.once('ready', () => {
  game.nightcity = game.nightcity || {};
  game.nightcity.diagnostics = networkDiagnostics;
  console.log(`${MODULE_ID} | Network diagnostics available at game.nightcity.diagnostics`);
});

export default networkDiagnostics;