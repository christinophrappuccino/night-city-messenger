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

/** EventBus events re-fired as Foundry hooks: `${MODULE_ID}.<eventName>` */
const MIRRORED_EVENTS = [
  'contact:updated',        // any player address-book change (via DocumentSyncBridge)
  'contacts:masterUpdated', // master directory add/update/remove ({ action, contactId })
  'contacts:trustChanged',
  'contacts:burned',
  'contacts:verified',
  'contacts:shared',
  'contacts:decrypted',     // a contact breach SUCCEEDED (encrypted contact revealed)
  'contacts:breachFailed',  // a contact breach FAILED — a "moment" for the spine
  'roles:updated',
  // ── Messaging (the "texts write moments" tie-in) ──
  // message:sent fires on the DELIVERING client (the GM's, when a player sends;
  // delivery always runs GM-side). Payload: { messageId, toActorId, toContactId,
  // fromActorId, fromContactId, network, subject, fromActorName, toActorName }.
  'message:sent',
  // message:received fires on clients owning the recipient actor, and the same
  // delivery can emit it from TWO sources (socket notify + journal doc-sync) —
  // integrators must dedupe by messageId, exactly as NCM's own toast does.
  'message:received',
  // ── Shards (the "shard reveals dossier knowledge" tie-in) ──
  'shard:decrypted',
  // ── Contact groups (a crew forming / changing is a relationship signal) ──
  // Payloads: created/updated { scope:'actor'|'master', actorId?, group },
  // deleted { scope, actorId?, groupId }, pushed { groupId, targetActorId, shared, failed }.
  // Members are address-keyed records (see scripts/utils/participants.js).
  'groups:created',
  'groups:updated',
  'groups:deleted',
  'groups:pushed',
];

export async function initializeIntegrationBridge() {
  const nc = game.nightcity;
  if (!nc?.eventBus) {
    log.warn('IntegrationBridge: eventBus unavailable — skipping (no API exposed)');
    return;
  }

  // ── 1. Mirror bus events as Foundry hooks ──
  for (const eventName of MIRRORED_EVENTS) {
    nc.eventBus.on(
      eventName,
      (data) => Hooks.callAll(`${MODULE_ID}.${eventName}`, data),
      'integration-bridge'
    );
  }

  // ── 2. Shared vocabulary (dynamic import keeps UI code off the boot path) ──
  let RELATIONSHIP_TYPES = null;
  let TRUST_LABELS = null;
  try {
    ({ RELATIONSHIP_TYPES, TRUST_LABELS } =
      await import('../ui/GMContactManager/GMContactManagerApp.js'));
  } catch (err) {
    log.warn('IntegrationBridge: could not load shared vocabulary', err);
  }

  // ── 3. Stable module API ──
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      /** Bump on breaking changes to THIS object's shape (semver). */
      apiVersion: '1.0.0',
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
