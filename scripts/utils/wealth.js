/**
 * A character's eddies — the ONE place that changes Cyberpunk RED's `system.wealth` (stage 2, batch 3).
 * @file scripts/utils/wealth.js
 * @module night-city-messenger
 *
 * CPR stores money as `actor.system.wealth = { value, transactions: [[description, reason], …] }`. Ten writers
 * (message eddies, claims, refunds, siphons, shard sales, the Encoder) each copied the object, changed the value,
 * pushed a ledger line and saved it. Two of them running at once on one character both started from the same copy,
 * and the later save erased the earlier change (a claim landing while a refund ran lost one of the two).
 *
 * `adjustWealth` does that read-change-save under `serialize('wealth:<actorId>')`, so changes to one character in
 * one browser happen one after another, each starting from the value the last one saved.
 *
 * It does ONLY the write. Each caller keeps its own rules, unchanged: who may write (owner / GM), whether the
 * balance must cover a payment, what to say on failure. The one rule it carries is `floor`: the message composer
 * never takes a balance below 0 (`floor: 0`); every other writer lets it go where the arithmetic says, as before.
 *
 * A failure (no permission, a server refusal) REJECTS, like the `actor.update` it wraps, so callers' existing
 * try/catch blocks see the same errors they always did.
 */

import { serialize } from './serialize.js';

const clone = (o) => (globalThis.foundry?.utils?.deepClone ? globalThis.foundry.utils.deepClone(o) : structuredClone(o));

/** The serialize key for one character's money. */
export const wealthKey = (actor) => `wealth:${actor?.id ?? actor?.uuid ?? '?'}`;

/**
 * The ledger line CPR shows for a change: "Increased by 50 to 1050" / "Decreased by 50 to 950".
 * @param {number} delta  signed change
 * @param {number} after  the new balance
 */
export function ledgerLine(delta, after) {
  return `${delta < 0 ? 'Decreased' : 'Increased'} by ${Math.abs(delta)} to ${after}`;
}

/**
 * Pure: the wealth object after a change. Never mutates its input.
 * @param {object} wealth  `{ value, transactions }` (either may be missing)
 * @param {number} delta   signed change in eb
 * @param {string} reason  the ledger reason
 * @param {{ floor?: number|null }} [opts]  floor: the lowest the balance may go (null = no floor)
 * @returns {{ wealth: object, before: number, after: number }}
 */
export function applyWealthChange(wealth, delta, reason, { floor = null } = {}) {
  const next = clone(wealth || { value: 0 });
  const before = Number(next.value) || 0;
  let after = before + (Number(delta) || 0);
  if (floor != null) after = Math.max(floor, after);
  next.value = after;
  next.transactions = Array.isArray(next.transactions) ? next.transactions : [];
  next.transactions.push([ledgerLine(Number(delta) || 0, after), reason]);
  return { wealth: next, before, after };
}

/**
 * Change a character's eddies by `delta` and save it, queued per character.
 * @param {Actor} actor
 * @param {number} delta   positive = credit, negative = debit
 * @param {string} reason  shown in the CPR wealth ledger
 * @param {{ floor?: number|null }} [opts]
 * @returns {Promise<{ before: number, after: number }>}  rejects when the save fails
 */
export function adjustWealth(actor, delta, reason, opts = {}) {
  if (!actor) return Promise.reject(new Error('No character to change the eddies of.'));
  return serialize(wealthKey(actor), async () => {
    // read INSIDE the queue: the previous change has been saved by now
    const { wealth, before, after } = applyWealthChange(actor.system?.wealth, delta, reason, opts);
    await actor.update({ 'system.wealth': wealth });
    return { before, after };
  });
}
