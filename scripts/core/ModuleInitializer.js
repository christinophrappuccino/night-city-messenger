/**
 * ModuleInitializer — Orchestrates module startup
 * @file scripts/core/ModuleInitializer.js
 * @module night-city-messenger
 * @description Manages priority-based initialization across Foundry hooks.
 *              Each registration file adds tasks that execute in priority order.
 */

import { log } from '../utils/helpers.js';
import { ncmNotify } from '../utils/notify.js';
import { SERVICE_MAP, affectedBy, startupImpact } from './serviceMap.js';

export class ModuleInitializer {
  constructor() {
    /** @type {Map<string, Array<{priority: number, name: string, fn: Function}>>} */
    this._phases = new Map();
    this._phases.set('preInit', []);
    this._phases.set('init', []);
    this._phases.set('ready', []);
    this._phases.set('postReady', []);
    /** Startup steps that threw — `{ phase, name, message }` (audit ARCH-02). @type {object[]} */
    this.failures = [];
  }

  /** @private Log a failed step and remember it, so the GM can be told once startup is over. */
  _failed(phase, task, error) {
    log.error(`  FAILED: ${task.name}`, error);
    this.failures.push({ phase, name: task.name, message: error?.message || String(error) });
  }

  /**
   * Tell the GM which startup steps failed (audit ARCH-02). They were only in the console, so the module could run
   * half-started with nothing on screen to say so. Once, after postReady; players are not told (they can't fix it).
   * @returns {number} how many failed
   */
  reportFailures() {
    const n = this.failures.length;
    // Which services a failure left missing, and which services use those directly (stage 2, batch 8: the notice
    // used to name only the step, so "Calls init failed" said nothing about voicemail and payphones stopping too).
    // Only looked for after a failure: a clean startup says nothing.
    const missing = n ? Object.keys(SERVICE_MAP).filter((k) => !game.nightcity?.[k]) : [];
    /** What the notice was built from — also on game.nightcity.startupReport for the console and the macros. */
    this.report = { failed: this.failures.map((f) => f.name), missing, affected: affectedBy(missing) };
    if (!n || !game.user?.isGM) return n;
    const impact = startupImpact({ failed: this.report.failed, missing });
    ncmNotify.error(`NCM | ${impact}${missing.length ? '' : ' Some features may not work.'} Press F12 and look for "FAILED" in the console for details.`, { permanent: true });
    return n;
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
        if (r && typeof r.then === 'function') pending.push(Promise.resolve(r).catch((error) => this._failed(phase, task, error)));
      } catch (error) {
        this._failed(phase, task, error);
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
        this._failed(phase, task, error);
      }
    }
  }
}
