/**
 * Saved security lockouts — the rules (audit remediation D3: DATA-05).
 * @file scripts/utils/lockoutRecord.js
 * @module night-city-messenger
 *
 * Who is locked out of what, and how many tries they have used, lived only in each browser's memory: a reload gave
 * a locked-out player a clean slate, a GM reload lost forced lockouts, and a player offline during a forced lockout
 * never got it. Now the active GM keeps them in the world setting `securityLockouts`
 * `{ "actorId::targetId": { attempts, maxAttempts, lockoutUntil, lockoutDuration, forced, reason, at } }`.
 * `lockoutUntil` is on the GAME clock (as before); `at` is the real time of the last change.
 *
 * Pure: no Foundry globals. Sim: dev/tools/sims/test-lockout-persist.mjs.
 */

/** Only these fields are saved. */
export function lockoutEntry(s = {}, at = Date.now()) {
  return {
    attempts: Math.max(0, Math.floor(Number(s.attempts) || 0)),
    maxAttempts: Math.max(1, Math.floor(Number(s.maxAttempts) || 3)),
    lockoutUntil: Number(s.lockoutUntil) > 0 ? Number(s.lockoutUntil) : null,
    lockoutDuration: Math.max(0, Number(s.lockoutDuration) || 0),
    forced: !!s.forced,
    reason: String(s.reason || '').slice(0, 200),
    at: Number(s.at) || at,
  };
}

/** Is this lockout still running at game time `now`? */
export const isLive = (e, now) => !!e?.lockoutUntil && e.lockoutUntil > now;

/** Nothing worth keeping: no tries used and no running lockout (an expired lockout resets the tries). */
export function isSpent(e, now) {
  if (!e) return true;
  if (e.lockoutUntil && e.lockoutUntil <= now) return true;   // expired: the counter resets with it
  return !(e.attempts > 0) && !isLive(e, now);
}

/**
 * GM: what to save when a PLAYER's client reports its state. A report may add tries or start / extend a lockout;
 * it can never end a running lockout early or lower the tries under it — only expiry or a GM clear does that.
 * @param {object|null} saved the saved entry
 * @param {object} report the player's reported state
 * @param {number} now game-clock ms
 * @returns {object|null} the entry to save, or null to remove it
 */
export function mergeReport(saved, report, now) {
  const r = lockoutEntry(report);
  if (isLive(saved, now)) {
    return { ...saved, attempts: Math.max(saved.attempts, r.attempts), lockoutUntil: Math.max(saved.lockoutUntil, r.lockoutUntil || 0), at: r.at };
  }
  return isSpent(r, now) ? null : r;
}

/**
 * Any client: combine the saved entry with what this client holds. The newer change wins (`at`), except that a
 * running saved lockout is never undone by an older-looking local copy.
 * @returns {object|null}
 */
export function mergeLocal(local, saved, now) {
  if (!saved) return local || null;
  if (!local) return saved;
  if (isLive(saved, now) && !isLive(local, now)) return { ...local, ...saved };
  return (Number(saved.at) || 0) >= (Number(local.at) || 0) ? { ...local, ...saved } : local;
}

/** The saved map without anything spent (expired lockouts, zero tries). */
export function prune(all = {}, now) {
  const out = {};
  for (const [k, e] of Object.entries(all || {})) if (k.includes('::') && !isSpent(e, now)) out[k] = e;
  return out;
}
