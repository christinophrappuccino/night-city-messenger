/**
 * The events NCM publishes to other modules — the ONE list (stage 2, batch 9).
 * @file scripts/integrations/publicEvents.js
 * @module night-city-messenger
 *
 * Each is re-fired as the Foundry hook `night-city-messenger.<name>` by IntegrationBridge, so another module listens
 * with `Hooks.on('night-city-messenger.message:sent', fn)` and never touches NCM's internals. This table is the
 * contract: what the event means, which client fires it, and the fields its payload can carry (a field may be absent
 * on some sends). `dev/tools/sims/test-public-events.mjs` checks that every send site's payload stays inside the
 * documented fields, that every event has a sender, and that INTEGRATION.md names them all.
 *
 * Adding one: a row here (the bridge picks it up), a line in INTEGRATION.md. Renaming one: keep the old name here
 * too, or other modules stop hearing it. Removing one is a breaking change for integrators — say so in INTEGRATION.md.
 */

/**
 * @typedef {object} PublicEvent
 * @property {string} name     the EventBus name; the hook is `night-city-messenger.<name>`
 * @property {string} means    one line, for integrators
 * @property {string} firesOn  which client(s) fire it
 * @property {string[]} fields the payload's possible top-level fields
 * @property {string} since    when it became public
 * @property {boolean} [once]  the bridge drops a repeat for the same `messageId` (see DEDUPE_MS)
 */

/** @type {readonly PublicEvent[]} */
export const PUBLIC_EVENTS = Object.freeze([
  { name: 'contact:updated', since: '2026-08', firesOn: 'every client that sees the change (document sync)',
    means: "a character's contact list changed, or the master directory setting did",
    fields: ['actorId', 'actorName', 'source', 'changedBy', 'settingChanged'] },
  { name: 'contacts:masterUpdated', since: '2026-08', firesOn: 'the client that made the change',
    means: 'the GM directory changed: a contact added, updated, removed, repaired, or a role deleted',
    fields: ['action', 'contactId', 'count', 'roleId'] },
  { name: 'contacts:trustChanged', since: '2026-08', firesOn: 'the client that made the change',
    means: "a player set a contact's trust", fields: ['actorId', 'contactId', 'contactName', 'trust'] },
  { name: 'contacts:shared', since: '2026-08', firesOn: 'the sharing client, and each receiving client',
    means: 'a contact was shared (Data Drop / push)', fields: ['shareId', 'contactName', 'delivered', 'total', 'senderName', 'recipientActorId'] },
  { name: 'contacts:decrypted', since: '2026-08', firesOn: 'the client that broke in (or the GM forcing it)',
    means: 'an encrypted contact was breached', fields: ['actorId', 'contactId', 'contactName', 'forced', 'roll'] },
  { name: 'contacts:breachFailed', since: '2026-08-14', firesOn: 'the client that tried',
    means: 'a contact breach failed', fields: ['actorId', 'contactId', 'contactName', 'roll'] },
  { name: 'roles:updated', since: '2026-08', firesOn: 'every client (document sync), and the GM who edited',
    means: 'the custom role list changed', fields: ['roles', 'source', 'settingChanged'] },
  { name: 'message:sent', since: '2026-08-14', firesOn: "the delivering client — the GM's, for a player's send",
    means: 'a message was delivered', fields: ['messageId', 'toActorId', 'toContactId', 'fromActorId', 'fromContactId', 'network', 'subject', 'fromActorName', 'toActorName'] },
  { name: 'message:received', since: '2026-08-14', once: true, firesOn: 'clients that own the recipient; once per message per client',
    means: 'a message arrived in an inbox this client can see',
    fields: ['messageId', 'toActorId', 'fromActorId', 'fromContactId', 'from', 'fromName', 'subject', 'preview', 'priority', 'anonymous', 'source', 'changedBy'] },
  { name: 'shard:decrypted', since: '2026-08-14', firesOn: 'the client that opened it (or the GM forcing it)',
    means: "a data shard's encryption was broken", fields: ['itemId', 'actorId'] },
  { name: 'groups:created', since: '2026-10-20', firesOn: 'the client that saved it',
    means: 'a contact group was created', fields: ['scope', 'actorId', 'group'] },
  { name: 'groups:updated', since: '2026-10-20', firesOn: 'the client that saved it',
    means: 'a contact group was changed', fields: ['scope', 'actorId', 'group'] },
  { name: 'groups:deleted', since: '2026-10-20', firesOn: 'the client that deleted it',
    means: 'a contact group was deleted', fields: ['scope', 'actorId', 'groupId'] },
  { name: 'groups:pushed', since: '2026-10-20', firesOn: "the GM's client",
    means: "the GM pushed a group to a character", fields: ['groupId', 'targetActorId', 'shared', 'failed'] },
]);

/** How long the bridge remembers a `once` event's messageId (the two sources of one delivery land within this). */
export const DEDUPE_MS = 10_000;

/**
 * Pure: should this payload be passed on, given what was passed on recently? Remembers what it lets through.
 * @param {Map<string, number>} seen  messageId → when it was passed on (mutated)
 * @param {object} data  the payload
 * @param {number} now   ms
 * @returns {boolean}
 */
export function passOnce(seen, data, now) {
  const id = data?.messageId;
  if (!id) return true;                                 // nothing to recognise it by: pass it on
  for (const [k, t] of seen) if (now - t > DEDUPE_MS) seen.delete(k);
  if (seen.has(id)) return false;
  seen.set(id, now);
  return true;
}
