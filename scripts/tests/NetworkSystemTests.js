/**
 * Phase 1 Network System Test Suite
 * File: scripts/tests/NetworkSystemTests.js
 * Module: cyberpunkred-messenger
 * Description: Comprehensive tests for Phase 1 network functionality
 * 
 * USAGE:
 * 1. Copy this file to scripts/tests/NetworkSystemTests.js
 * 2. In Foundry console: const tests = await import('./modules/cyberpunkred-messenger/scripts/tests/NetworkSystemTests.js')
 * 3. Run: await tests.runAllTests()
 */

import { MODULE_ID } from '../utils/constants.js';

export class NetworkSystemTests {
  
  constructor() {
    this.results = [];
    this.passed = 0;
    this.failed = 0;
  }
  
  /**
   * Run a single test
   * @private
   */
  async _runTest(name, testFn) {
    console.log(`${MODULE_ID} | Testing: ${name}...`);
    
    try {
      await testFn();
      this.passed++;
      this.results.push({ name, passed: true, error: null });
      console.log(`${MODULE_ID} | ✅ PASS: ${name}`);
      return true;
    } catch (error) {
      this.failed++;
      this.results.push({ name, passed: false, error: error.message });
      console.error(`${MODULE_ID} | ❌ FAIL: ${name}`, error);
      return false;
    }
  }
  
  /**
   * Assert helper
   * @private
   */
  _assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }
  
  /**
   * Test 1: NetworkManager exists
   */
  async testNetworkManagerExists() {
    this._assert(game.nightcity, 'game.nightcity namespace not found');
    this._assert(game.nightcity.networkManager, 'networkManager not initialized');
    this._assert(typeof game.nightcity.networkManager.connectToNetwork === 'function', 
      'networkManager missing connectToNetwork method');
  }
  
  /**
   * Test 2: NetworkStorage exists
   */
  async testNetworkStorageExists() {
    this._assert(game.nightcity.NetworkStorage, 'NetworkStorage not available');
    this._assert(typeof game.nightcity.NetworkStorage.getAllNetworks === 'function',
      'NetworkStorage missing getAllNetworks method');
  }
  
  /**
   * Test 3: NetworkUtils exists
   */
  async testNetworkUtilsExists() {
    this._assert(game.nightcity.NetworkUtils, 'NetworkUtils not available');
    this._assert(typeof game.nightcity.NetworkUtils.formatNetworkName === 'function',
      'NetworkUtils missing formatNetworkName method');
  }
  
  /**
   * Test 4: Default networks created
   */
  async testDefaultNetworksCreated() {
    const networks = await game.nightcity.NetworkStorage.getAllNetworks();
    this._assert(Array.isArray(networks), 'getAllNetworks did not return array');
    this._assert(networks.length >= 4, `Expected at least 4 networks, got ${networks.length}`);
    
    // Check for required networks
    const requiredNetworks = ['CITINET', 'CORPNET', 'DARKNET', 'DEAD_ZONE'];
    for (const id of requiredNetworks) {
      const found = networks.find(n => n.id === id);
      this._assert(found, `Required network not found: ${id}`);
    }
  }
  
  /**
   * Test 5: Get available networks
   */
  async testGetAvailableNetworks() {
    const available = await game.nightcity.networkManager.getAvailableNetworks();
    this._assert(Array.isArray(available), 'getAvailableNetworks did not return array');
    this._assert(available.length > 0, 'No networks available');
    
    // CITINET should always be available (global: true)
    const citinet = available.find(n => n.id === 'CITINET');
    this._assert(citinet, 'CITINET not in available networks');
  }
  
  /**
   * Test 6: Connect to CITINET (no auth)
   */
  async testConnectToCITINET() {
    const result = await game.nightcity.networkManager.connectToNetwork('CITINET');
    this._assert(result.success === true, 'Failed to connect to CITINET');
    
    const status = game.nightcity.networkManager.getNetworkStatus();
    this._assert(status.connected === true, 'Status shows not connected');
  }
  
  /**
   * Test 7: Connect to CORPNET requires auth
   */
  async testCORPNETRequiresAuth() {
    const result = await game.nightcity.networkManager.connectToNetwork('CORPNET');
    
    if (game.user.isGM) {
      // GM should bypass
      this._assert(result.success === true, 'GM should bypass auth');
      this._assert(result.gmOverride === true, 'GM override flag not set');
    } else {
      // Player should be blocked
      this._assert(result.success === false, 'Should fail without auth');
      this._assert(result.requiresAuth === true, 'Should indicate auth required');
    }
  }
  
  /**
   * Test 8: Create custom network (GM only)
   */
  async testCreateCustomNetwork() {
    if (!game.user.isGM) {
      console.log(`${MODULE_ID} | Skipping GM-only test: createCustomNetwork`);
      return;
    }
    
    const testNetwork = {
      id: 'TEST_NETWORK_' + Date.now(),
      name: 'Test Network',
      type: 'custom',
      availability: { global: true, scenes: [] },
      signalStrength: 75,
      reliability: 90,
      security: {
        level: 'low',
        requiresAuth: false,
        password: null,
        bypassDC: 10,
        attempts: 5,
        lockoutDuration: 60000
      },
      effects: {
        messageDelay: 0,
        traced: false,
        anonymity: false,
        canRoute: true
      },
      theme: {
        color: '#ff00ff',
        icon: 'fa-star',
        glitchIntensity: 0.3
      },
      description: 'Test network for automated tests',
      hidden: false,
      gmNotes: 'Auto-generated test network'
    };
    
    const created = await game.nightcity.NetworkStorage.createNetwork(testNetwork);
    this._assert(created, 'Network not created');
    this._assert(created.id === testNetwork.id, 'Created network has wrong ID');
    
    // Verify it exists
    const retrieved = await game.nightcity.NetworkStorage.getNetwork(created.id);
    this._assert(retrieved, 'Could not retrieve created network');
    this._assert(retrieved.name === testNetwork.name, 'Retrieved network has wrong name');
    
    // Clean up
    await game.nightcity.NetworkStorage.deleteNetwork(created.id);
  }
  
  /**
   * Test 9: Update network (GM only)
   */
  async testUpdateNetwork() {
    if (!game.user.isGM) {
      console.log(`${MODULE_ID} | Skipping GM-only test: updateNetwork`);
      return;
    }
    
    // Create test network
    const testId = 'TEST_UPDATE_' + Date.now();
    await game.nightcity.NetworkStorage.createNetwork({
      id: testId,
      name: 'Original Name',
      type: 'custom',
      availability: { global: true, scenes: [] },
      signalStrength: 50,
      reliability: 50,
      security: { level: 'none', requiresAuth: false, password: null, bypassDC: 0, attempts: 0, lockoutDuration: 0 },
      effects: { messageDelay: 0, traced: false, anonymity: false, canRoute: false },
      theme: { color: '#ffffff', icon: 'fa-wifi', glitchIntensity: 0 },
      description: 'Test',
      hidden: false,
      gmNotes: ''
    });
    
    // Update it
    await game.nightcity.NetworkStorage.updateNetwork(testId, {
      name: 'Updated Name',
      signalStrength: 99
    });
    
    // Verify update
    const updated = await game.nightcity.NetworkStorage.getNetwork(testId);
    this._assert(updated.name === 'Updated Name', 'Name not updated');
    this._assert(updated.signalStrength === 99, 'Signal strength not updated');
    
    // Clean up
    await game.nightcity.NetworkStorage.deleteNetwork(testId);
  }
  
  /**
   * Test 10: Delete network (GM only)
   */
  async testDeleteNetwork() {
    if (!game.user.isGM) {
      console.log(`${MODULE_ID} | Skipping GM-only test: deleteNetwork`);
      return;
    }
    
    // Create test network
    const testId = 'TEST_DELETE_' + Date.now();
    await game.nightcity.NetworkStorage.createNetwork({
      id: testId,
      name: 'To Be Deleted',
      type: 'custom',
      availability: { global: true, scenes: [] },
      signalStrength: 50,
      reliability: 50,
      security: { level: 'none', requiresAuth: false, password: null, bypassDC: 0, attempts: 0, lockoutDuration: 0 },
      effects: { messageDelay: 0, traced: false, anonymity: false, canRoute: false },
      theme: { color: '#ffffff', icon: 'fa-wifi', glitchIntensity: 0 },
      description: 'Test',
      hidden: false,
      gmNotes: ''
    });
    
    // Verify it exists
    let network = await game.nightcity.NetworkStorage.getNetwork(testId);
    this._assert(network, 'Test network not created');
    
    // Delete it
    await game.nightcity.NetworkStorage.deleteNetwork(testId);
    
    // Verify it's gone
    network = await game.nightcity.NetworkStorage.getNetwork(testId);
    this._assert(!network, 'Network still exists after deletion');
  }
  
  /**
   * Test 11: Network validation
   */
  async testNetworkValidation() {
    // Valid network
    const validNetwork = {
      id: 'VALID',
      name: 'Valid Network',
      type: 'custom',
      availability: { global: true, scenes: [] },
      signalStrength: 75,
      reliability: 90,
      security: { level: 'none', requiresAuth: false, password: null, bypassDC: 0, attempts: 0, lockoutDuration: 0 },
      effects: { messageDelay: 0, traced: false, anonymity: false, canRoute: false },
      theme: { color: '#ffffff', icon: 'fa-wifi', glitchIntensity: 0 },
      description: 'Test',
      hidden: false,
      gmNotes: ''
    };
    
    this._assert(game.nightcity.NetworkStorage.validateNetwork(validNetwork) === true,
      'Valid network failed validation');
    
    // Invalid network (missing name)
    const invalidNetwork = {
      id: 'INVALID',
      type: 'custom'
    };
    
    this._assert(game.nightcity.NetworkStorage.validateNetwork(invalidNetwork) === false,
      'Invalid network passed validation');
  }
  
  /**
   * Test 12: Network utils - signal bars
   */
  async testNetworkUtilsSignalBars() {
    const html = game.nightcity.NetworkUtils.generateSignalBars(75);
    this._assert(typeof html === 'string', 'Signal bars not a string');
    this._assert(html.includes('signal-bars'), 'Signal bars HTML missing class');
    this._assert(html.includes('active'), 'Signal bars HTML missing active bars');
  }
  
  /**
   * Test 13: Network utils - format network name
   */
  async testNetworkUtilsFormatName() {
    const name = game.nightcity.NetworkUtils.formatNetworkName('citinet');
    this._assert(name === 'CITINET', `Expected CITINET, got ${name}`);
    
    const network = { name: 'test network' };
    const formatted = game.nightcity.NetworkUtils.formatNetworkName(network);
    this._assert(formatted === 'TEST NETWORK', `Expected TEST NETWORK, got ${formatted}`);
  }
  
  /**
   * Test 14: Network utils - security level
   */
  async testNetworkUtilsSecurityLevel() {
    const high = game.nightcity.NetworkUtils.formatSecurityLevel('high');
    this._assert(high === 'HIGH SECURITY', `Expected HIGH SECURITY, got ${high}`);
    
    const none = game.nightcity.NetworkUtils.formatSecurityLevel('none');
    this._assert(none === 'OPEN', `Expected OPEN, got ${none}`);
  }
  
  /**
   * Test 15: Get network status
   */
  async testGetNetworkStatus() {
    const status = game.nightcity.networkManager.getNetworkStatus();
    this._assert(typeof status === 'object', 'Status is not an object');
    this._assert('connected' in status, 'Status missing connected property');
  }
  
  /**
   * Run all tests
   */
  async runAllTests() {
    console.log(`${MODULE_ID} | ========================================`);
    console.log(`${MODULE_ID} | 🧪 RUNNING NETWORK SYSTEM TESTS`);
    console.log(`${MODULE_ID} | ========================================`);
    
    this.results = [];
    this.passed = 0;
    this.failed = 0;
    
    const tests = [
      ['NetworkManager exists', () => this.testNetworkManagerExists()],
      ['NetworkStorage exists', () => this.testNetworkStorageExists()],
      ['NetworkUtils exists', () => this.testNetworkUtilsExists()],
      ['Default networks created', () => this.testDefaultNetworksCreated()],
      ['Get available networks', () => this.testGetAvailableNetworks()],
      ['Connect to CITINET', () => this.testConnectToCITINET()],
      ['CORPNET requires auth', () => this.testCORPNETRequiresAuth()],
      ['Create custom network (GM)', () => this.testCreateCustomNetwork()],
      ['Update network (GM)', () => this.testUpdateNetwork()],
      ['Delete network (GM)', () => this.testDeleteNetwork()],
      ['Network validation', () => this.testNetworkValidation()],
      ['NetworkUtils signal bars', () => this.testNetworkUtilsSignalBars()],
      ['NetworkUtils format name', () => this.testNetworkUtilsFormatName()],
      ['NetworkUtils security level', () => this.testNetworkUtilsSecurityLevel()],
      ['Get network status', () => this.testGetNetworkStatus()]
    ];
    
    for (const [name, testFn] of tests) {
      await this._runTest(name, testFn);
    }
    
    // Display results
    console.log(`${MODULE_ID} | ========================================`);
    console.log(`${MODULE_ID} | 📊 TEST RESULTS`);
    console.log(`${MODULE_ID} | ========================================`);
    console.log(`${MODULE_ID} | Passed: ${this.passed}`);
    console.log(`${MODULE_ID} | Failed: ${this.failed}`);
    console.log(`${MODULE_ID} | Total: ${this.results.length}`);
    console.log(`${MODULE_ID} | ========================================`);
    
    // Show failed tests
    const failed = this.results.filter(r => !r.passed);
    if (failed.length > 0) {
      console.log(`${MODULE_ID} | ❌ Failed tests:`);
      for (const test of failed) {
        console.log(`${MODULE_ID} |   - ${test.name}: ${test.error}`);
      }
    } else {
      console.log(`${MODULE_ID} | ✅ All tests passed!`);
    }
    
    // Create chat message with results
    const successRate = ((this.passed / this.results.length) * 100).toFixed(1);
    const color = this.failed === 0 ? '#00ff00' : (this.failed < 5 ? '#ff9900' : '#ff0000');
    
    await ChatMessage.create({
      content: `
        <div style="background: rgba(0,0,0,0.8); border: 2px solid ${color}; padding: 15px; border-radius: 4px;">
          <h3 style="color: ${color}; margin: 0 0 10px 0;">
            <i class="fas fa-vial"></i> Network System Tests
          </h3>
          <p><strong>Tests Run:</strong> ${this.results.length}</p>
          <p style="color: #00ff00;"><strong>Passed:</strong> ${this.passed}</p>
          <p style="color: #ff0000;"><strong>Failed:</strong> ${this.failed}</p>
          <p><strong>Success Rate:</strong> ${successRate}%</p>
          ${failed.length > 0 ? `
            <hr style="border-color: rgba(255,255,255,0.2); margin: 10px 0;"/>
            <p style="font-size: 0.9em; color: #ccc;"><strong>Failed Tests:</strong></p>
            <ul style="font-size: 0.85em; color: #ff9900;">
              ${failed.map(t => `<li>${t.name}</li>`).join('')}
            </ul>
          ` : ''}
        </div>
      `,
      whisper: [game.user.id]
    });
    
    return {
      passed: this.passed,
      failed: this.failed,
      total: this.results.length,
      results: this.results
    };
  }
}

/**
 * Quick test runner (can be called from console)
 */
export async function runAllTests() {
  const tester = new NetworkSystemTests();
  return await tester.runAllTests();
}

/**
 * Run a single test by name
 */
export async function runTest(testName) {
  const tester = new NetworkSystemTests();
  
  const methodName = 'test' + testName.replace(/\s+/g, '');
  if (typeof tester[methodName] === 'function') {
    return await tester._runTest(testName, () => tester[methodName]());
  } else {
    console.error(`${MODULE_ID} | Test not found: ${testName}`);
    return false;
  }
}

console.log(`${MODULE_ID} | Test suite loaded. Run with: runAllTests()`);