/**
 * Force Refresh — Admin → Tools (audit leftover, dev 2026-11-05)
 * @file scripts/utils/forceRefresh.js
 * @module night-city-messenger
 * @description Re-read the parts of NCM that cache world data, and redraw every open NCM window on THIS client.
 *              The GM's button runs it locally and tells every other client to (SOCKET_OPS.ADMIN_FORCE_REFRESH).
 *              No page reload: nothing anyone is typing is lost.
 */

import { log } from './helpers.js';

/**
 * @param {{ windows?: Iterable<object>, reloaders?: Array<() => any> }} [deps] for sims; defaults read Foundry
 * @returns {number} how many NCM windows were redrawn
 */
export function refreshNcmWindows(deps = {}) {
  const ns = globalThis.game?.nightcity;
  const reloaders = deps.reloaders ?? [() => ns?.masterContactService?.reloadFromSetting?.()];
  for (const r of reloaders) {
    try { r(); } catch (err) { log.warn(`Force refresh: a reload failed: ${err.message}`); }
  }
  const windows = deps.windows ?? globalThis.foundry?.applications?.instances?.values?.() ?? [];
  let n = 0;
  for (const app of windows) {
    if (!app?.rendered || !app.element?.classList?.contains?.('ncm-app')) continue;
    try { app.render(); n += 1; } catch (err) { log.warn(`Force refresh: could not redraw ${app.id}: ${err.message}`); }
  }
  return n;
}
