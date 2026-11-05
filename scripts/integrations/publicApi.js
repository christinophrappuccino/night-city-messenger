/**
 * The public API, v2 — `game.modules.get('night-city-messenger').api.v2` (stage 2, step 18).
 * @file scripts/integrations/publicApi.js
 * @module night-city-messenger
 *
 * For other modules and macros. Documented in docs/API.md; `dev/tools/sims/test-public-api.mjs` calls every method as
 * a GM and as a player and checks the result shape.
 *
 * Rules every method keeps (the reasons are in ARCHITECTURE-HEALTH-REPORT.md §D):
 *   - It is a thin facade over the SAME service method the UI uses, so it is exactly as safe as the UI: Foundry's
 *     document permissions on direct writes, and the GM's socket checks on relayed ones. The API is not a sandbox.
 *   - It resolves `{ ok: true, data }` or `{ ok: false, code, error }`. It never throws for an expected failure and
 *     never shows a toast. Codes: BAD_INPUT, NOT_GM, NOT_OWNER, NOT_FOUND, FEATURE_OFF, UNAVAILABLE, FAILED.
 *   - Inputs and outputs are plain objects and ids — never a Foundry document or a service instance — so NCM's
 *     internals can change without breaking callers.
 *   - Events can be listened to, never emitted (`events.on`), and only the documented ones (publicEvents.js).
 *
 * Versioning: `version` is semver. Adding a method or a field is a minor bump; removing or changing one is a major
 * bump, with the old shape kept for one minor version first.
 */

import { MODULE_ID } from '../utils/constants.js';
import { isFeatureOn, featureList, FEATURES } from '../utils/features.js';
import { resolveDisplayName } from '../utils/helpers.js';
import { PUBLIC_EVENTS } from './publicEvents.js';

export const API_V2_VERSION = '2.0.0';

/** The error codes a v2 method can return. */
export const API_CODES = Object.freeze(['BAD_INPUT', 'NOT_GM', 'NOT_OWNER', 'NOT_FOUND', 'FEATURE_OFF', 'UNAVAILABLE', 'FAILED']);

const ok = (data) => ({ ok: true, data });
const no = (code, error) => ({ ok: false, code, error });
const nc = () => globalThis.game?.nightcity;
const gm = () => !!globalThis.game?.user?.isGM;
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Run a method body; an unexpected throw becomes FAILED (an API call never throws). */
const guard = (fn) => async (...args) => {
  try { return await fn(...args); } catch (err) { return no('FAILED', err?.message || String(err)); }
};

/** The actor, if this user may act for it (owner or GM). */
function ownActor(actorId) {
  const id = str(actorId);
  if (!id) return { err: no('BAD_INPUT', 'An actorId is required.') };
  const actor = globalThis.game?.actors?.get?.(id);
  if (!actor) return { err: no('NOT_FOUND', `No actor ${id}.`) };
  if (!gm() && !actor.isOwner) return { err: no('NOT_OWNER', 'You do not own that character.') };
  return { actor };
}

const service = (name) => nc()?.[name] || null;

/** An item by uuid or id, in the world or any actor's inventory (the launchers' own rule, without their toasts). */
function findItem(ref) {
  const s = str(ref);
  if (!s) return null;
  let item = null;
  try { item = globalThis.fromUuidSync?.(s) ?? null; } catch { item = null; }
  item ??= globalThis.game?.items?.get?.(s) ?? null;
  if (!item) for (const a of globalThis.game?.actors ?? []) { item = a.items?.get?.(s) ?? null; if (item) break; }
  return item;
}
const needs = (name) => service(name) ? null : no('UNAVAILABLE', `NCM's ${name} is not running (check the startup report).`);

// ── plain shapes ──
const messageSummary = (m) => ({
  id: m.messageId, threadId: m.threadId ?? null, subject: m.subject ?? '', from: m.from ?? '', to: m.to ?? '',
  fromActorId: m.fromActorId ?? null, fromContactId: m.fromContactId ?? null, toActorId: m.toActorId ?? null, toContactId: m.toContactId ?? null,
  timestamp: m.timestamp ?? null, priority: m.priority ?? 'normal', network: m.network ?? null,
  read: !!m.status?.read, sent: String(m.messageId || '').endsWith('-sent'), spam: !!m.status?.spam,
  preview: String(m.body ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140),
});
const contactSummary = (c) => ({
  id: c.id, name: c.name ?? '', email: c.email ?? '', actorId: c.actorId ?? null, trust: c.trust ?? null,
  role: c.role ?? '', portrait: service('portraitService')?.resolvePortrait?.(c) || c.portrait || null,
});
const groupSummary = (g) => ({ id: g.id, name: g.name ?? '', scope: g.scope ?? null, ownerActorId: g.ownerActorId ?? null, members: (g.members || []).length });
const networkSummary = (n) => (n ? { id: n.id, name: n.name ?? n.id, type: n.type ?? null } : null);

/**
 * Build the v2 object. Called once by IntegrationBridge at postReady; everything it touches is looked up at call time.
 * @returns {object}
 */
export function buildApiV2() {
  const api = {
    version: API_V2_VERSION,
    codes: API_CODES,

    // ───────────────────────── features ─────────────────────────
    features: {
      /** @param {string} name a feature id (see list()) @returns {boolean} on in this load */
      has: (name) => isFeatureOn(name),
      /** @returns {Array<{name,label,on,live,requires}>} every optional system and whether it is on */
      list: () => featureList().map(({ name, label, on, live, requires }) => ({ name, label, on, live, requires })),
    },

    // ───────────────────────── events ─────────────────────────
    events: {
      /** The event names you can listen to (publicEvents.js documents each payload). */
      names: PUBLIC_EVENTS.map((e) => e.name),
      /**
       * Listen to a documented event. The callback gets the payload (plain fields). Same as
       * Hooks.on('night-city-messenger.<name>') — including the once-per-message rule for message:received.
       * @param {string} name @param {Function} cb
       * @returns {Function} call it to stop listening (or null when the name is not a public event)
       */
      on: (name, cb) => {
        if (!PUBLIC_EVENTS.some((e) => e.name === name) || typeof cb !== 'function') return null;
        const hook = `${MODULE_ID}.${name}`;
        const id = Hooks.on(hook, cb);
        return () => Hooks.off(hook, id);
      },
    },

    // ───────────────────────── time ─────────────────────────
    time: {
      /** @returns {string} the game time NCM uses, ISO-8601 (UTC) */
      now: () => service('timeService')?.getCurrentTime?.() ?? new Date().toISOString(),
      /** @returns {number} the same, in ms */
      nowMs: () => service('timeService')?.getCurrentTimeMs?.() ?? Date.now(),
      /** @returns {object|null} which clock (real / world / manual / Simple Calendar…) */
      provider: () => service('timeService')?.getProviderInfo?.() ?? null,
    },

    // ───────────────────────── messages ─────────────────────────
    messages: {
      /**
       * Send a message, the way the composer does (players' sends relay to the GM, who re-checks them).
       * @param {object} o { toActorId | toContactId, fromActorId | fromContactId (GM), subject, body, priority? }
       * @returns {Promise<{ok, data:{messageId}}>}
       */
      send: guard(async (o = {}) => {
        if (needs('messageService')) return needs('messageService');
        if (!str(o.toActorId) && !str(o.toContactId)) return no('BAD_INPUT', 'Give toActorId or toContactId.');
        if (!str(o.fromActorId) && !str(o.fromContactId)) return no('BAD_INPUT', 'Give fromActorId (or, as GM, fromContactId).');
        if (str(o.fromContactId) && !str(o.fromActorId) && !gm()) return no('NOT_GM', 'Only the GM sends as a directory contact.');
        if (str(o.fromActorId)) { const r = ownActor(o.fromActorId); if (r.err) return r.err; }
        const data = { toActorId: str(o.toActorId), toContactId: str(o.toContactId), fromActorId: str(o.fromActorId), fromContactId: str(o.fromContactId),
          subject: String(o.subject ?? ''), body: String(o.body ?? ''), priority: str(o.priority) || 'normal' };
        const res = await service('messageService').sendMessage(data);
        return res?.success ? ok({ messageId: res.messageId ?? null }) : no('FAILED', res?.error || 'The message was not sent.');
      }),
      /**
       * A character's mail, newest first, as summaries (no bodies).
       * @param {string} actorId @param {object} [o] { limit = 50, unreadOnly = false }
       */
      listFor: guard(async (actorId, o = {}) => {
        if (needs('messageService')) return needs('messageService');
        const r = ownActor(actorId); if (r.err) return r.err;
        let list = (await service('messageService').getMessages(r.actor.id)) || [];
        list = list.filter((m) => !m.status?.deleted);
        if (o.unreadOnly) list = list.filter((m) => !m.status?.read);
        list.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
        return ok(list.slice(0, Math.max(1, Math.min(500, Number(o.limit) || 50))).map(messageSummary));
      }),
      /** Mark one of a character's messages read. @param {string} actorId @param {string} messageId */
      markRead: guard(async (actorId, messageId) => {
        if (needs('messageService')) return needs('messageService');
        const r = ownActor(actorId); if (r.err) return r.err;
        if (!str(messageId)) return no('BAD_INPUT', 'A messageId is required.');
        const res = await service('messageService').markAsRead(r.actor.id, messageId);
        return res?.success ? ok({ messageId }) : no('NOT_FOUND', res?.error || 'No such message in that inbox.');
      }),
    },

    // ───────────────────────── contacts ─────────────────────────
    contacts: {
      /** A character's own contact list. @param {string} actorId */
      listFor: guard(async (actorId) => {
        if (needs('contactRepository')) return needs('contactRepository');
        const r = ownActor(actorId); if (r.err) return r.err;
        return ok(((await service('contactRepository').getContacts(r.actor.id)) || []).map(contactSummary));
      }),
      /**
       * The name NCM shows for someone (the directory beats an actor's own name).
       * @param {object} ref { contactId?, actorId?, email? }
       */
      resolveName: guard(async (ref = {}) => ok(resolveDisplayName({ contactId: str(ref.contactId), actorId: str(ref.actorId), email: str(ref.email) }, ''))),
      /** The picture NCM shows for a directory contact. @param {string} contactId */
      resolvePortrait: guard(async (contactId) => {
        const c = service('masterContactService')?.getContact?.(str(contactId));
        if (!c) return no('NOT_FOUND', 'No such directory contact.');
        return ok(service('portraitService')?.resolvePortrait?.(c) || null);
      }),
    },

    // ───────────────────────── directory (GM) ─────────────────────────
    directory: {
      /** Every directory contact (GM only — it holds GM notes). */
      list: guard(async () => {
        if (!gm()) return no('NOT_GM', 'The directory is the GM\'s.');
        if (needs('masterContactService')) return needs('masterContactService');
        return ok((service('masterContactService').getAll() || []).map(contactSummary));
      }),
      /** One directory contact (GM only). @param {string} contactId */
      get: guard(async (contactId) => {
        if (!gm()) return no('NOT_GM', 'The directory is the GM\'s.');
        const c = service('masterContactService')?.getContact?.(str(contactId));
        return c ? ok(contactSummary(c)) : no('NOT_FOUND', 'No such directory contact.');
      }),
    },

    // ───────────────────────── groups ─────────────────────────
    groups: {
      /**
       * The groups a composer could send to: a character's own (owner or GM), plus the GM's (GM only).
       * @param {object} [o] { actorId? }
       */
      list: guard(async (o = {}) => {
        if (needs('contactGroupService')) return needs('contactGroupService');
        let actorId = null;
        if (str(o.actorId)) { const r = ownActor(o.actorId); if (r.err) return r.err; actorId = r.actor.id; }
        return ok((service('contactGroupService').groupsFor({ actorId }) || []).map(groupSummary));
      }),
      /** Who a group sends to. @param {string} groupId @param {object} [o] { actorId? } — the group's owner */
      recipientsFor: guard(async (groupId, o = {}) => {
        const svc = service('contactGroupService');
        if (!svc) return needs('contactGroupService');
        let actorId = null;
        if (str(o.actorId)) { const r = ownActor(o.actorId); if (r.err) return r.err; actorId = r.actor.id; }
        const g = svc.findGroup(str(groupId), { actorId });
        if (!g || (g.scope === 'master' && !gm()) || (!g.scope && !gm())) return no('NOT_FOUND', 'No such group for you.');
        const { recipients = [], unresolved = [] } = svc.recipientsFor(g) || {};
        return ok({ recipients: recipients.map((x) => ({ actorId: x.actorId ?? null, contactId: x.contactId ?? null, email: x.email ?? '', name: x.name ?? '' })), unresolved });
      }),
    },

    // ───────────────────────── networks (read) ─────────────────────────
    networks: {
      /** This client's connection: { network, signal, deadZone, simple }. */
      status: guard(async () => {
        const n = service('networkService');
        if (!n) return needs('networkService');
        return ok({ network: networkSummary(n.currentNetwork), signal: n.signalStrength ?? 0, deadZone: !!n.isDeadZone, simple: !!n.simple });
      }),
      /** The networks on offer on this client's scene. */
      available: guard(async () => {
        const n = service('networkService');
        if (!n) return needs('networkService');
        return ok((n.getAvailableNetworks() || []).map(networkSummary));
      }),
    },

    // ───────────────────────── open (windows) ─────────────────────────
    open: {
      /** @param {string} actorId @param {object} [o] { messageId? } */
      inbox: guard(async (actorId, o = {}) => {
        const r = ownActor(actorId); if (r.err) return r.err;
        if (typeof nc()?.openInbox !== 'function') return no('UNAVAILABLE', 'The inbox launcher is not running.');
        nc().openInbox(r.actor.id, str(o.messageId) || undefined);
        return ok(true);
      }),
      /** @param {object} [o] the composer's prefill: { toActorId?, subject?, body?, fromActorId? } */
      composer: guard(async (o = {}) => {
        if (typeof nc()?.composeMessage !== 'function') return no('UNAVAILABLE', 'The composer launcher is not running.');
        nc().composeMessage({ ...o });
        return ok(true);
      }),
      /** @param {string} itemIdOrUuid a data shard */
      shard: guard(async (itemIdOrUuid) => {
        if (!str(itemIdOrUuid)) return no('BAD_INPUT', 'An item id or uuid is required.');
        if (typeof nc()?.openDataShard !== 'function') return no('UNAVAILABLE', 'The shard launcher is not running.');
        const item = findItem(itemIdOrUuid);
        if (!item || !service('dataShardService')?.isDataShard?.(item)) return no('NOT_FOUND', 'No such data shard.');
        await nc().openDataShard(item);
        return ok(true);
      }),
      /** @param {string} itemIdOrUuid a terminal */
      terminal: guard(async (itemIdOrUuid) => {
        if (!str(itemIdOrUuid)) return no('BAD_INPUT', 'An item id or uuid is required.');
        if (typeof nc()?.openTerminal !== 'function') return no('UNAVAILABLE', 'The terminal launcher is not running.');
        const item = findItem(itemIdOrUuid);
        if (!item || !service('terminalService')?.isTerminal?.(item)) return no('NOT_FOUND', 'No such terminal.');
        await nc().openTerminal(item);
        return ok(true);
      }),
      /** @param {string} nodeId a network node (refused in simple network mode) */
      node: guard(async (nodeId) => {
        if (!isFeatureOn('networks')) return no('FEATURE_OFF', 'Simple network mode is on: network nodes do nothing.');
        if (!str(nodeId)) return no('BAD_INPUT', 'A nodeId is required.');
        if (!service('networkService')?.getNode?.(str(nodeId))) return no('NOT_FOUND', 'No such node.');
        nc().openNode(str(nodeId));
        return ok(true);
      }),
    },
  };
  // every namespace and the whole object are frozen: a caller cannot replace a method other callers use
  for (const k of Object.keys(api)) if (api[k] && typeof api[k] === 'object' && !Array.isArray(api[k])) Object.freeze(api[k]);
  return Object.freeze(api);
}

/** For the sim: the feature ids an integrator can pass to features.has. */
export const _featureIds = () => Object.keys(FEATURES);
