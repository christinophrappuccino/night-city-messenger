/**
 * Phase 3 System Verification
 * @file scripts/tests/Phase3Verification.js
 * @module cyberpunkred-messenger
 * @description Verifies all Phase 3 network system components are properly
 *              initialized and functional.
 *              Run via: game.nightcity.verifyPhase3()
 */

import { MODULE_ID, EVENTS, SOCKET_OPS, NETWORKS, NETWORK_TYPES, SECURITY_LEVELS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

export class Phase3Verification {

  /**
   * Run full Phase 3 verification suite.
   * @returns {{ passed: number, failed: number, results: object[] }}
   */
  static run() {
    const results = [];
    const ns = game.nightcity;

    log.info('╔══════════════════════════════════════════╗');
    log.info('║   Phase 3 Verification — Network System  ║');
    log.info('╚══════════════════════════════════════════╝');

    // ═══════════════════════════════════════════════════════
    //  Service Existence
    // ═══════════════════════════════════════════════════════

    results.push(this._check('NetworkService exists', () => ns.networkService != null));
    results.push(this._check('SecurityService exists', () => ns.securityService != null));
    results.push(this._check('NetworkAccessLogService exists', () => ns.accessLogService != null));

    // ═══════════════════════════════════════════════════════
    //  NetworkService — Core Methods
    // ═══════════════════════════════════════════════════════

    results.push(this._check('NetworkService.currentNetworkId', () =>
      typeof ns.networkService?.currentNetworkId === 'string' && ns.networkService.currentNetworkId.length > 0
    ));

    results.push(this._check('NetworkService.currentNetwork returns object', () =>
      ns.networkService?.currentNetwork != null && typeof ns.networkService.currentNetwork === 'object'
    ));

    results.push(this._check('NetworkService.getAllNetworks() returns array', () =>
      Array.isArray(ns.networkService?.getAllNetworks())
    ));

    results.push(this._check('NetworkService has core networks (5)', () =>
      ns.networkService?.getAllNetworks()?.length >= 5
    ));

    results.push(this._check('NetworkService.getAvailableNetworks() returns array', () =>
      Array.isArray(ns.networkService?.getAvailableNetworks())
    ));

    results.push(this._check('NetworkService.getNetwork(CITINET) works', () => {
      const net = ns.networkService?.getNetwork(NETWORKS.CITINET);
      return net != null && net.name === 'CitiNet';
    }));

    results.push(this._check('NetworkService.getNetwork(CORPNET) works', () => {
      const net = ns.networkService?.getNetwork(NETWORKS.CORPNET);
      return net != null && net.name === 'CorpNet';
    }));

    results.push(this._check('NetworkService.getNetwork(DARKNET) works', () => {
      const net = ns.networkService?.getNetwork(NETWORKS.DARKNET);
      return net != null && net.name === 'DarkNet';
    }));

    results.push(this._check('NetworkService.isDeadZone is boolean', () =>
      typeof ns.networkService?.isDeadZone === 'boolean'
    ));

    results.push(this._check('NetworkService.signalStrength is number', () =>
      typeof ns.networkService?.signalStrength === 'number'
    ));

    results.push(this._check('switchNetwork() exists', () =>
      typeof ns.networkService?.switchNetwork === 'function'
    ));

    results.push(this._check('authenticatePassword() exists', () =>
      typeof ns.networkService?.authenticatePassword === 'function'
    ));

    results.push(this._check('authenticateSkillCheck() exists', () =>
      typeof ns.networkService?.authenticateSkillCheck === 'function'
    ));

    results.push(this._check('canAccessNetwork() exists', () =>
      typeof ns.networkService?.canAccessNetwork === 'function'
    ));

    results.push(this._check('createNetwork() exists', () =>
      typeof ns.networkService?.createNetwork === 'function'
    ));

    results.push(this._check('updateNetwork() exists', () =>
      typeof ns.networkService?.updateNetwork === 'function'
    ));

    results.push(this._check('deleteNetwork() exists', () =>
      typeof ns.networkService?.deleteNetwork === 'function'
    ));

    results.push(this._check('toggleDeadZone() exists', () =>
      typeof ns.networkService?.toggleDeadZone === 'function'
    ));

    results.push(this._check('checkReliability() exists', () =>
      typeof ns.networkService?.checkReliability === 'function'
    ));

    results.push(this._check('getMessageDelay() exists', () =>
      typeof ns.networkService?.getMessageDelay === 'function'
    ));

    // ═══════════════════════════════════════════════════════
    //  NetworkService — Core Network Properties
    // ═══════════════════════════════════════════════════════

    const citinet = ns.networkService?.getNetwork(NETWORKS.CITINET);
    if (citinet) {
      results.push(this._check('CITINET has correct structure', () =>
        citinet.id === 'CITINET' &&
        citinet.isCore === true &&
        citinet.availability?.global === true &&
        typeof citinet.signalStrength === 'number' &&
        typeof citinet.reliability === 'number' &&
        citinet.security != null &&
        citinet.effects != null &&
        citinet.theme != null
      ));
    }

    // ═══════════════════════════════════════════════════════
    //  SecurityService — Core Methods
    // ═══════════════════════════════════════════════════════

    results.push(this._check('SecurityService.getState() exists', () =>
      typeof ns.securityService?.getState === 'function'
    ));

    results.push(this._check('SecurityService.isLockedOut() exists', () =>
      typeof ns.securityService?.isLockedOut === 'function'
    ));

    results.push(this._check('SecurityService.recordFailedAttempt() exists', () =>
      typeof ns.securityService?.recordFailedAttempt === 'function'
    ));

    results.push(this._check('SecurityService.recordSuccess() exists', () =>
      typeof ns.securityService?.recordSuccess === 'function'
    ));

    results.push(this._check('SecurityService.resetState() exists', () =>
      typeof ns.securityService?.resetState === 'function'
    ));

    results.push(this._check('SecurityService.getActiveLockouts() exists', () =>
      typeof ns.securityService?.getActiveLockouts === 'function'
    ));

    // SecurityService functional test
    results.push(this._check('SecurityService: attempt tracking works', () => {
      const testActor = 'test-actor-verify';
      const testTarget = 'test-target-verify';

      ns.securityService.initTracking(testActor, testTarget, { maxAttempts: 2, lockoutDuration: 1000 });

      const state1 = ns.securityService.getState(testActor, testTarget);
      if (state1.attempts !== 0) return false;

      ns.securityService.recordFailedAttempt(testActor, testTarget);
      const state2 = ns.securityService.getState(testActor, testTarget);
      if (state2.attempts !== 1) return false;

      const { lockedOut } = ns.securityService.recordFailedAttempt(testActor, testTarget);
      if (!lockedOut) return false;

      const isLocked = ns.securityService.isLockedOut(testActor, testTarget);
      if (!isLocked) return false;

      // Clean up
      ns.securityService.resetState(testActor, testTarget);
      return true;
    }));

    // ═══════════════════════════════════════════════════════
    //  NetworkAccessLogService — Core Methods
    // ═══════════════════════════════════════════════════════

    results.push(this._check('AccessLogService.getEntries() exists', () =>
      typeof ns.accessLogService?.getEntries === 'function'
    ));

    results.push(this._check('AccessLogService.getStats() exists', () =>
      typeof ns.accessLogService?.getStats === 'function'
    ));

    results.push(this._check('AccessLogService.addEntry() exists', () =>
      typeof ns.accessLogService?.addEntry === 'function'
    ));

    results.push(this._check('AccessLogService.clearLog() exists', () =>
      typeof ns.accessLogService?.clearLog === 'function'
    ));

    results.push(this._check('AccessLogService.exportLog() exists', () =>
      typeof ns.accessLogService?.exportLog === 'function'
    ));

    // ═══════════════════════════════════════════════════════
    //  Socket Handlers
    // ═══════════════════════════════════════════════════════

    results.push(this._check('SocketManager has NETWORK_STATE_CHANGED handler', () =>
      ns.socketManager?._handlers?.has(SOCKET_OPS.NETWORK_STATE_CHANGED)
    ));

    // ═══════════════════════════════════════════════════════
    //  UI Launch Functions
    // ═══════════════════════════════════════════════════════

    results.push(this._check('openNetworkManagement() is real (not stub)', () => {
      const fn = ns.openNetworkManagement;
      return typeof fn === 'function' && !fn.toString().includes('Phase 3');
    }));

    results.push(this._check('getCurrentNetwork() exists', () =>
      typeof ns.getCurrentNetwork === 'function'
    ));

    results.push(this._check('getSignalStrength() exists', () =>
      typeof ns.getSignalStrength === 'function'
    ));

    results.push(this._check('getAvailableNetworks() exists', () =>
      typeof ns.getAvailableNetworks === 'function'
    ));

    results.push(this._check('setNetwork() exists', () =>
      typeof ns.setNetwork === 'function'
    ));

    results.push(this._check('toggleDeadZone() (API) exists', () =>
      typeof ns.toggleDeadZone === 'function'
    ));

    results.push(this._check('connectToNetwork() exists', () =>
      typeof ns.connectToNetwork === 'function'
    ));

    // ═══════════════════════════════════════════════════════
    //  Constants Validation
    // ═══════════════════════════════════════════════════════

    results.push(this._check('EVENTS.NETWORK_CHANGED defined', () => !!EVENTS.NETWORK_CHANGED));
    results.push(this._check('EVENTS.NETWORK_CONNECTED defined', () => !!EVENTS.NETWORK_CONNECTED));
    results.push(this._check('EVENTS.NETWORK_DISCONNECTED defined', () => !!EVENTS.NETWORK_DISCONNECTED));
    results.push(this._check('EVENTS.NETWORK_AUTH_SUCCESS defined', () => !!EVENTS.NETWORK_AUTH_SUCCESS));
    results.push(this._check('EVENTS.NETWORK_AUTH_FAILURE defined', () => !!EVENTS.NETWORK_AUTH_FAILURE));
    results.push(this._check('EVENTS.NETWORK_LOCKOUT defined', () => !!EVENTS.NETWORK_LOCKOUT));
    results.push(this._check('SOCKET_OPS.NETWORK_STATE_CHANGED defined', () => !!SOCKET_OPS.NETWORK_STATE_CHANGED));
    results.push(this._check('NETWORK_TYPES has 5 types', () => Object.keys(NETWORK_TYPES).length >= 5));
    results.push(this._check('SECURITY_LEVELS has 5 levels', () => Object.keys(SECURITY_LEVELS).length >= 5));

    // ═══════════════════════════════════════════════════════
    //  Output Summary
    // ═══════════════════════════════════════════════════════

    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;

    console.group(`%c${MODULE_ID} Phase 3 Verification`, 'font-weight:bold; font-size:14px');
    for (const r of results) {
      const icon = r.ok ? '✅' : '❌';
      const color = r.ok ? 'color: #00ff41' : 'color: #f65261; font-weight: bold';
      console.log(`%c${icon} ${r.name}`, color, r.detail || '');
    }
    console.log(`\n%cPassed: ${passed}  |  Failed: ${failed}  |  Total: ${results.length}`,
      failed > 0 ? 'color: #f65261; font-weight: bold' : 'color: #00ff41; font-weight: bold');
    console.groupEnd();

    return { passed, failed, results };
  }

  /**
   * Helper: run a check and capture result.
   * @param {string} name
   * @param {Function} fn - Returns boolean
   * @returns {{ name: string, ok: boolean, detail: string }}
   * @private
   */
  static _check(name, fn) {
    try {
      const ok = fn();
      return { name, ok: !!ok, detail: '' };
    } catch (error) {
      return { name, ok: false, detail: error.message };
    }
  }
}
