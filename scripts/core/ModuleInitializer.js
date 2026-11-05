/**
 * ModuleInitializer — Orchestrates module startup
 * @file scripts/core/ModuleInitializer.js
 * @module night-city-messenger
 * @description Manages priority-based initialization across Foundry hooks.
 *              Each registration file adds tasks that execute in priority order.
 */

import { log } from '../utils/helpers.js';

export class ModuleInitializer {
  constructor() {
    /** @type {Map<string, Array<{priority: number, name: string, fn: Function}>>} */
    this._phases = new Map();
    this._phases.set('preInit', []);
    this._phases.set('init', []);
    this._phases.set('ready', []);
    this._phases.set('postReady', []);
  }

  /**
   * Register a task for a specific phase
   * @param {string} phase - 'preInit' | 'init' | 'ready' | 'postReady'
   * @param {number} priority - Lower runs first (use increments of 10)
   * @param {string} name - Human-readable task name
   * @param {Function} fn - Async-safe function to execute
   */
  register(phase, priority, name, fn) {
    const tasks = this._phases.get(phase);
    if (!tasks) throw new Error(`Unknown phase: ${phase}`);
    tasks.push({ priority, name, fn });
  }

  /**
   * Run a phase's tasks NOW, in priority order, each to its first await (audit COMPAT-01 / FBL-07). Used for
   * preInit + init inside Foundry's `init` hook, which does not wait for async callbacks: everything a task does
   * synchronously (settings, helpers, the canvas layer, keybindings, hooks, the enricher) is registered before
   * the hook returns. A task that returns a promise is not waited for here; its promise joins the result.
   * @param {string} phase
   * @returns {Promise<void>} settles when every task's promise has (failures are logged, never thrown)
   */
  runPhaseNow(phase) {
    const tasks = this._phases.get(phase);
    if (!tasks || tasks.length === 0) return Promise.resolve();
    tasks.sort((a, b) => a.priority - b.priority);
    log.info(`Running phase: ${phase} (${tasks.length} tasks)`);
    const pending = [];
    for (const task of tasks) {
      try {
        log.debug(`  [${task.priority}] ${task.name}`);
        const r = task.fn();
        if (r && typeof r.then === 'function') pending.push(Promise.resolve(r).catch((error) => log.error(`  FAILED: ${task.name}`, error)));
      } catch (error) {
        log.error(`  FAILED: ${task.name}`, error);
      }
    }
    return Promise.all(pending).then(() => {});
  }

  /**
   * Execute all tasks in a phase, sorted by priority
   * @param {string} phase
   */
  async runPhase(phase) {
    const tasks = this._phases.get(phase);
    if (!tasks || tasks.length === 0) return;

    tasks.sort((a, b) => a.priority - b.priority);
    log.info(`Running phase: ${phase} (${tasks.length} tasks)`);

    for (const task of tasks) {
      try {
        log.debug(`  [${task.priority}] ${task.name}`);
        await task.fn();
      } catch (error) {
        log.error(`  FAILED: ${task.name}`, error);
      }
    }
  }
}
