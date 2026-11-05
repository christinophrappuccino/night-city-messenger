/**
 * Integration Bridge
 * @file scripts/integrations/IntegrationBridge.js
 * @module night-city-messenger
 * @description Public integration surface for other modules (e.g. Cyberpunk
 *              Relationships). Two jobs:
 *                1. Mirror the private EventBus contact events as standard
 *                   Foundry hooks ("night-city-messenger.<event>") so other
 *                   modules can listen without touching game.nightcity internals.
 *                2. Expose a stable API object at the standard Foundry discovery
 *                   point: game.modules.get('night-city-messenger').api
 *              Purely additive — nothing internal changes behavior. If this file
 *              is deleted, the messenger works exactly as before.
 */

import { log } from '../utils/helpers.js';
import { MODULE_ID } from '../utils/constants.js';
import { PUBLIC_EVENTS, passOnce } from './publicEvents.js';

// The events published to other modules, what they carry and which client fires them: publicEvents.js (the contract).

export async function initializeIntegrationBridge() {
  const nc = game.nightcity;
  if (!nc?.eventBus) {
    log.warn('IntegrationBridge: eventBus unavailable — skipping (no API exposed)');
    return;
  }

  // ── 1. Mirror bus events as Foundry hooks ──
  // A `once` event fires its hook once per message on this client: one delivery reaches message:received from two
  // sources (the socket notice and the journal sync). Integrators used to have to drop the second themselves.
  for (const { name, once } of PUBLIC_EVENTS) {
    const seen = once ? new Map() : null;
    nc.eventBus.on(
      name,
      (data) => { if (seen && !passOnce(seen, data, Date.now())) return; Hooks.callAll(`${MODULE_ID}.${name}`, data); },
      'integration-bridge'
    );
  }

  // ── 2. Shared vocabulary (dynamic import keeps UI code off the boot path) ──
  let RELATIONSHIP_TYPES = null;
  let TRUST_LABELS = null;
  try {
    ({ RELATIONSHIP_TYPES, TRUST_LABELS } =
      await import('../utils/contactVocab.js'));
  } catch (err) {
    log.warn('IntegrationBridge: could not load shared vocabulary', err);
  }

  // ── 3. Stable module API ──
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      /** Bump on breaking changes to THIS object's shape (semver). */
      apiVersion: '1.1.0',   // 1.1.0 (2026-11-05): + publicEvents
      /** The events this module publishes as `night-city-messenger.<name>` hooks: name, meaning, firing client, payload fields. */
      publicEvents: PUBLIC_EVENTS,
      /** Macro-level helpers: sendMessage, scheduling, master-contact trio, UI launchers. */
      messenger: nc.messenger ?? null,
      /** Per-actor address books (actor flags): getContacts, addContact, setTrust, findByEmail… */
      contacts: nc.contactRepository ?? null,
      /** GM master directory (world setting): getAll, getByActorId, getByEmail, pushToPlayer… */
      masterContacts: nc.masterContactService ?? null,
      /** Contact groups (read for all, writes GM-only; members are address-keyed — resolve via groups.recipientsFor). */
      groups: nc.contactGroupService ?? null,
      /** Portrait resolution identical to the messenger UI's fallback chain. */
      portraits: nc.portraitService ?? null,
      /** Direct bus access when hooks aren't enough: on(event, cb, ownerId) → { unsubscribe }. */
      eventBus: nc.eventBus,
      /**
       * One clock for Night City: the messenger's TimeService (6-mode provider).
       * Integrators (e.g. Cyberpunk Relationships) defer to this instead of
       * shipping their own copy, so the two clocks can never drift.
       */
      time: nc.timeService
        ? {
            getCurrentTime: () => nc.timeService.getCurrentTime(),
            getCurrentTimeMs: () => nc.timeService.getCurrentTimeMs(),
            getProviderInfo: () => nc.timeService.getProviderInfo(),
          }
        : null,
      /** Shared vocab so integrators don't hardcode copies. */
      RELATIONSHIP_TYPES,
      TRUST_LABELS,
    };
  }

  Hooks.callAll(`${MODULE_ID}.apiReady`, mod?.api ?? null);
  log.info('IntegrationBridge online — module API exposed, contact events mirrored to Foundry hooks');
}
