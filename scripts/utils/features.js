/**
 * The feature registry: which optional systems this world has switched on (stage 2, step 14).
 * @file scripts/utils/features.js
 * @module night-city-messenger
 *
 * A feature is a system the GM can switch off with one world setting. Off means NOT INSTALLED: its startup steps are
 * skipped (`initializer.register(…, { feature })`), its socket requests get a "switched off" answer instead of a
 * handler (`socketManager.register(…, { feature })`), and its UI asks `isFeatureOn`. Data is never touched, so
 * switching it back on restores everything.
 *
 * The answer is read ONCE per load and then kept: every feature setting is `requiresReload`, so what a client
 * installed at startup is what it reports until the reload, even in the moment between the GM saving the setting and
 * the reload. A feature whose `requires` is off is off too, and that is decided here, nowhere else.
 */

import { MODULE_ID, SOCKET_OPS } from './constants.js';

/**
 * name → { setting, label, requires[], offReply? }
 * `offReply(op, data, sender)` → `{ op, data }` the GM sends back when a player's request for an off feature arrives,
 * or null to drop it. Without it, requests for an off feature are dropped (and logged at debug level).
 */
export const FEATURES = Object.freeze({
  conversations: {
    setting: 'conversationsEnabled',
    label: 'Conversations (group chat)',
    requires: [],
    offReply: (op, data, sender) => (op === SOCKET_OPS.CONVERSATION_REQUEST && data?.reqId
      ? { op: SOCKET_OPS.CONVERSATION_RESULT, data: { forUserId: sender, reqId: data.reqId, res: { ok: false, off: true, error: 'Conversations are switched off.' } } }
      : null),
  },
  // Calls and its parts (stage 2, step 15). The call request ops are fire-and-forget, so an off feature's requests
  // are dropped: there is no reply for a player to wait on. The services always exist (numbers, payphone and script
  // data stay editable for the GM); what is skipped is the live machinery and the player's way in.
  calls:     { setting: 'callsEnabled',     label: 'Calls',           requires: [] },
  payphones: { setting: 'payphonesEnabled', label: 'Payphones',       requires: ['calls'] },
  emergency: { setting: 'emergencyEnabled', label: 'Emergency lines', requires: ['calls'] },
  overheard: { setting: 'overheardEnabled', label: 'Overheard calls', requires: ['calls'] },
});

const cache = new Map();

/** The feature's own switch, ignoring what it requires. Unknown name or unreadable setting → off. */
function ownSwitch(name) {
  const f = FEATURES[name];
  if (!f) return false;
  try { return !!globalThis.game?.settings?.get(MODULE_ID, f.setting); } catch { return false; }
}

/**
 * Is this feature on in this load? (Its own setting, and every feature it requires.)
 * @param {string} name a key of FEATURES
 * @returns {boolean}
 */
export function isFeatureOn(name, _seen = new Set()) {
  if (cache.has(name)) return cache.get(name);
  if (_seen.has(name)) return false;                       // a requires loop is a bug; treat it as off
  _seen.add(name);
  const f = FEATURES[name];
  const on = !!f && ownSwitch(name) && (f.requires || []).every((r) => isFeatureOn(r, _seen));
  // Only remember an answer once settings can be read (a call before init would otherwise pin "off" for the load).
  if (globalThis.game?.settings?.settings?.has?.(`${MODULE_ID}.${f?.setting}`) || f === undefined) cache.set(name, on);
  return on;
}

/** Every feature with its state, for the startup report, the admin panel and the API. */
export function featureList() {
  return Object.entries(FEATURES).map(([name, f]) => ({ name, label: f.label, setting: f.setting, requires: [...(f.requires || [])], on: isFeatureOn(name) }));
}

/** The names of the features that are off in this load. */
export function featuresOff() { return Object.keys(FEATURES).filter((n) => !isFeatureOn(n)); }

/** For sims only: forget the answers so a new world can be read. */
export function _resetFeatureCache() { cache.clear(); }
