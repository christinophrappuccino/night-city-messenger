/**
 * One write at a time per key (audit remediation B4: DATA-04, DATA-15, INT-02, INT-03, INT-06, INT-09, INT-11).
 * @file scripts/utils/serialize.js
 * @module night-city-messenger
 *
 * Most of the module's writes read a whole record (a world-setting list, a flag block), change it, and save
 * it back. Two of those running at once both start from the same copy, and the later save silently undoes the
 * earlier one: a log row vanishes, a plant comes back, a wiped file is lost. Socket handlers run concurrently,
 * so this happens whenever two players act together.
 *
 * `serialize(key, fn)` runs `fn` after every earlier call with the same key has finished (resolved OR failed).
 * It is the network-node writer queue (`NODE_WRITERS`, NetworkService) made generic.
 *
 * DEADLOCK RULE: a function running under a key must never await another call under the SAME key — it would
 * wait for itself. Wrap the outermost read-modify-write only, never something it calls.
 *
 * The queue is per browser. One GM handles each request (B1), so the GM-side writers are covered; a player's
 * own writes (their actor's contacts) are covered on their own client.
 */

const chains = new Map();

/**
 * Run `fn` after everything queued under `key` so far.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>} fn's result (or its rejection)
 */
export function serialize(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const run = () => fn();
  const p = prev.then(run, run);
  const tail = p.then(() => {}, () => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return p;
}

/**
 * Wrap prototype methods so each call runs under a key computed from its arguments.
 * A key of null/undefined runs the method at once (nothing to protect).
 * @param {object} proto
 * @param {string[]} names
 * @param {(args: any[], name: string) => string|null} keyOf  called with `this` = the instance
 */
export function serializeMethods(proto, names, keyOf) {
  for (const name of names) {
    const orig = proto[name];
    if (typeof orig !== 'function' || orig.ncmSerialized) continue;
    const wrapped = function serialized(...args) {
      const key = keyOf.call(this, args, name);
      return key == null ? orig.apply(this, args) : serialize(key, () => orig.apply(this, args));
    };
    wrapped.ncmSerialized = true;
    wrapped.ncmOriginal = orig;
    proto[name] = wrapped;
  }
}

/** Keys with work still queued (for tests). */
export function busyKeys() { return [...chains.keys()]; }

/** The key for an item-scoped write: the uuid (an embedded item's id is only unique inside its actor). */
export function itemKey(prefix, item) {
  const id = item?.uuid || item?.id;
  return id ? `${prefix}:${id}` : null;
}
