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
import { resolveDisplayName, getSetting } from '../utils/helpers.js';
import { itemTypes } from '../utils/cpr.js';
import { PUBLIC_EVENTS } from './publicEvents.js';
import { registerTerminalCommand, _registry as TERMINAL_COMMANDS } from '../utils/terminalCommands.js';
import { SHARED_SCOPE } from '../utils/terminalFiles.js';
import { addActionProvider, removeActionProvider, addQuickReplyRule, removeQuickReplyRule, refreshViewers } from '../utils/messageActions.js';

export const API_V2_VERSION = '2.3.0';   // 2.3.0: messages.addActions / removeActions / quickReply / refresh, directory.remove · 2.1.0: directory add/update/pushToPlayer, groups.push, calls, networks.set · 2.2.0: shards, items, terminals, hud, networks.forScene

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
/** A service's own answer ({ success | ok, error, … }) → the v2 result. */
const fromService = (res, data = () => ({})) => (res && (res.success === true || res.ok === true)
  ? ok(data(res)) : no('FAILED', res?.error || (res?.reason ? `Refused: ${String(res.reason).replace(/_/g, ' ')}.` : 'NCM refused it.')));
const callSummary = (l) => ({ callId: l.callId, direction: l.direction === 'out' ? 'out' : 'in', outcome: l.outcome ?? null,
  otherName: l.other?.name ?? '', otherNumber: l.other?.number ?? '', seconds: Number(l.seconds) || 0, startedAt: l.startedAt || 0,
  gameTime: l.gameTime || '', seen: !!l.seen, written: !!l.written });
const networkSummary = (n) => (n ? { id: n.id, name: n.name ?? n.id, type: n.type ?? null } : null);
const entrySummary = (m) => ({ id: m.id ?? m.messageId ?? null, subject: m.subject ?? '', from: m.from ?? '', contentType: m.contentType ?? null, timestamp: m.timestamp ?? null,
  encrypted: !!m.encrypted, envelope: m.envelope ?? 'mail', filename: m.file?.filename ?? null });
const timerSummary = (t) => ({ id: t.id, title: t.title ?? '', text: t.text ?? '', count: t.count ?? null, expiresAt: t.expiresAt ?? null, tone: t.tone ?? 'amber', icon: t.icon ?? null,
  everyone: t.everyone !== false, gmOnly: !!t.gmOnly, actorIds: [...(t.actorIds || [])] });
const short = (v, n) => String(v ?? '').slice(0, n);
const nowMs = () => service('timeService')?.getCurrentTimeMs?.() ?? Date.now();
/** A data shard by id or uuid (NOT_FOUND otherwise). */
function shardItem(ref) {
  const item = findItem(ref);
  return item && service('dataShardService')?.isDataShard?.(item) ? { item } : { err: no('NOT_FOUND', 'No such data shard.') };
}
function terminalItem(ref) {
  const item = findItem(ref);
  return item && service('terminalService')?.isTerminal?.(item) ? { item } : { err: no('NOT_FOUND', 'No such terminal.') };
}

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
      /**
       * 2.3.0: put your own buttons under a message in the inbox. provider(message, context) returns an array of
       * { label, icon?, tooltip?, primary?, disabled?, run } (or { actions, note }, or null for none); message is the
       * headers only (id, threadId, subject, from…, toActorId, timestamp, read, sent), context is { actorId, isGM }.
       * Called on every render of a shown message; errors are caught. Returns { id } (pass the same id to replace it).
       */
      addActions: guard(async (provider, o = {}) => (typeof provider === 'function' ? ok({ id: addActionProvider(provider, o.id) }) : no('BAD_INPUT', 'A provider must be a function.'))),
      /** 2.3.0: take your buttons away again. @param {string} id */
      removeActions: guard(async (id) => (removeActionProvider(str(id)) ? ok({ id }) : no('NOT_FOUND', 'No such provider.'))),
      /** 2.3.0: decide whether the quick-reply box shows for a message: rule(message, context) => false hides it
       *  (true or nothing leaves it). Any rule saying false wins. Pass { remove: id } to take a rule away. */
      quickReply: guard(async (rule, o = {}) => { if (o.remove) return removeQuickReplyRule(str(o.remove)) ? ok({ id: o.remove }) : no('NOT_FOUND', 'No such rule.'); return typeof rule === 'function' ? ok({ id: addQuickReplyRule(rule, o.id) }) : no('BAD_INPUT', 'A rule must be a function.'); }),
      /** 2.3.0: redraw open inboxes (after your actions or rules changed). */
      refresh: guard(async () => ok({ redrawn: refreshViewers() })),
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
      /** Add a directory contact (GM). @param {object} data { name, email?, role?, notes?, actorId?, portrait? … } — as the GM's form takes */
      add: guard(async (data = {}) => {
        if (!gm()) return no('NOT_GM', 'The directory is the GM\'s.');
        if (needs('masterContactService')) return needs('masterContactService');
        if (!str(data?.name)) return no('BAD_INPUT', 'A contact needs a name.');
        return fromService(await service('masterContactService').addContact({ ...data }), (r) => ({ contactId: r.contact?.id ?? null }));
      }),
      /** Change a directory contact (GM). @param {string} contactId @param {object} changes */
      update: guard(async (contactId, changes = {}) => {
        if (!gm()) return no('NOT_GM', 'The directory is the GM\'s.');
        if (needs('masterContactService')) return needs('masterContactService');
        if (!service('masterContactService').getContact?.(str(contactId))) return no('NOT_FOUND', 'No such directory contact.');
        return fromService(await service('masterContactService').updateContact(str(contactId), { ...changes }), () => ({ contactId: str(contactId) }));
      }),
      /**
       * 2.3.0: delete a directory contact (GM), e.g. a single-use contact a macro made. Its aliases are re-homed as in
       * the GM's directory. { fromCharacters: true } also takes it out of every character's own contact list (the copies
       * pushToPlayer made, matched by masterContactId); otherwise those copies stay as unverified contacts, as when the
       * GM deletes one by hand.
       * @param {string} contactId @param {object} [o] { fromCharacters = false }
       * @returns {Promise<{ok, data:{ contactId, fromCharacters: number }}>}
       */
      remove: guard(async (contactId, o = {}) => {
        if (!gm()) return no('NOT_GM', 'The directory is the GM\'s.');
        if (needs('masterContactService')) return needs('masterContactService');
        const id = str(contactId); if (!id) return no('BAD_INPUT', 'A contactId is required.');
        if (!service('masterContactService').getContact?.(id)) return no('NOT_FOUND', 'No such directory contact.');
        /* the copies are found first: removing the directory contact re-verifies characters' lists, which unlinks them */
        const copies = [];
        if (o.fromCharacters) for (const a of globalThis.game?.actors?.contents || []) for (const c of (a.getFlag?.(MODULE_ID, 'contacts') || []).filter((x) => x.masterContactId === id)) copies.push([a.id, c.id]);
        const res = await service('masterContactService').removeContact(id);
        if (!res?.success) return no('FAILED', res?.error || 'The contact was not removed.');
        let n = 0; const repo = service('contactRepository');
        for (const [actorId, cid] of copies) { const r = repo ? await repo.removeContact(actorId, cid) : { success: false }; if (r?.success) n++; }
        return ok({ contactId: id, fromCharacters: n });
      }),
      /** Put a directory contact in a character's own contact list (GM). @param {string} contactId @param {string} actorId */
      pushToPlayer: guard(async (contactId, actorId) => {
        if (!gm()) return no('NOT_GM', 'The directory is the GM\'s.');
        if (needs('masterContactService')) return needs('masterContactService');
        const r = ownActor(actorId); if (r.err) return r.err;
        if (!service('masterContactService').getContact?.(str(contactId))) return no('NOT_FOUND', 'No such directory contact.');
        return fromService(await service('masterContactService').pushToPlayer(str(contactId), r.actor.id), () => ({ contactId: str(contactId), actorId: r.actor.id }));
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
      /** Give one of the GM's groups to a character, sharing any member they don't know yet (GM). */
      push: guard(async (groupId, actorId) => {
        if (!gm()) return no('NOT_GM', 'Only the GM pushes groups.');
        if (needs('contactGroupService')) return needs('contactGroupService');
        const r = ownActor(actorId); if (r.err) return r.err;
        const res = await service('contactGroupService').pushGroupToPlayer(str(groupId), r.actor.id);
        if (res?.error === 'Group not found') return no('NOT_FOUND', 'No such GM group.');
        return fromService(res, (x) => ({ shared: x.shared ?? 0, failed: [...(x.failed || [])] }));
      }),
    },

    // ───────────────────────── calls ─────────────────────────
    calls: {
      /**
       * Place a call, as the call screen does. A player calls as their character ({ actorId } one they own, else
       * their assigned character); a GM may call as any character or directory contact ({ actorId } / { contactId }).
       * @param {string} number @param {object} [as]
       */
      place: guard(async (number, as = {}) => {
        if (!isFeatureOn('calls')) return no('FEATURE_OFF', 'Calls are switched off in this world.');
        if (needs('callService')) return needs('callService');
        if (!str(number)) return no('BAD_INPUT', 'A number is required.');
        const who = {};
        if (str(as?.actorId)) { const r = ownActor(as.actorId); if (r.err) return r.err; who.actorId = r.actor.id; }
        if (str(as?.contactId)) { if (!gm()) return no('NOT_GM', 'Only the GM calls as a directory contact.'); who.contactId = str(as.contactId); }
        return fromService(await service('callService').placeCall(str(number), who), (x) => ({ callId: x.call?.id ?? null, emergency: !!x.emergency }));
      }),
      /** A character's call log, newest first (owner / GM; a directory contact's: GM). @param {string} ownerId */
      logFor: guard(async (ownerId) => {
        if (!isFeatureOn('calls')) return no('FEATURE_OFF', 'Calls are switched off in this world.');
        if (needs('callService')) return needs('callService');
        const id = str(ownerId);
        if (!id) return no('BAD_INPUT', 'An actorId or contactId is required.');
        if (globalThis.game?.actors?.get?.(id)) { const r = ownActor(id); if (r.err) return r.err; }
        else if (!gm()) return no('NOT_GM', 'A directory contact\'s calls are the GM\'s.');
        else if (!service('masterContactService')?.getContact?.(id)) return no('NOT_FOUND', 'No such character or directory contact.');
        return ok(((await service('callService').getLog(id)) || []).map(callSummary));
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
      /** The networks that reach a scene, and whether it is a dead zone (any scene, not just this client's). */
      forScene: guard(async (sceneId) => {
        const n = service('networkService');
        if (!n) return needs('networkService');
        const id = str(sceneId);
        if (!id) return no('BAD_INPUT', 'A sceneId is required.');
        if (globalThis.game?.scenes && !globalThis.game.scenes.get?.(id)) return no('NOT_FOUND', 'No such scene.');
        const cfg = n.getSceneNetworkConfig?.(id) ?? {};
        return ok({ sceneId: id, networks: (n.getAvailableNetworksFor(id) || []).map(networkSummary), defaultNetwork: cfg.defaultNetwork ?? null, deadZone: !n.simple && !!cfg.deadZone, simple: !!n.simple });
      }),
      /** Put THIS client on a network (GM — as the GM's macro does; players switch through their network selector). */
      set: guard(async (networkId) => {
        if (!gm()) return no('NOT_GM', 'Only the GM switches by API.');
        const n = service('networkService');
        if (!n) return needs('networkService');
        if (!n.getNetwork?.(str(networkId))) return no('NOT_FOUND', 'No such network.');
        if (n.simple && str(networkId) !== 'CITINET') return no('FEATURE_OFF', 'Simple network mode is on: everyone is on CitiNet.');
        const res = await n.switchNetwork(str(networkId), { force: true });
        return fromService(res, () => networkSummary(n.currentNetwork));
      }),
    },

    // ───────────────────────── shards (GM) ─────────────────────────
    shards: {
      /** What is on a data shard, as summaries (no bodies). GM only: it shows locked and hidden entries too. */
      entries: guard(async (ref) => {
        if (!gm()) return no('NOT_GM', 'A shard\'s whole contents are the GM\'s.');
        if (needs('dataShardService')) return needs('dataShardService');
        const r = shardItem(ref); if (r.err) return r.err;
        return ok(((await service('dataShardService').getShardMessages(r.item)) || []).map(entrySummary));
      }),
      /** The logins a shard's Credentials entries hold: [{ entryId, host, user, note, encrypted, cracked }] (never the secret). GM only. */
      credentials: guard(async (ref) => {
        if (!gm()) return no('NOT_GM', 'A shard\'s whole contents are the GM\'s.');
        if (needs('dataShardService')) return needs('dataShardService');
        const r = shardItem(ref); if (r.err) return r.err;
        const out = [];
        for (const m of (await service('dataShardService').getShardMessages(r.item)) || []) {
          if (m.contentType !== 'credentials') continue;
          for (const e of m.contentData?.entries || []) out.push({ entryId: m.id ?? null, host: String(e.host ?? ''), user: String(e.user ?? ''), note: String(e.note ?? ''), encrypted: !!e.encrypted, cracked: !!e.cracked });
        }
        return ok(out);
      }),
      /** Write an entry onto a shard, as the GM's composer does (a file when `file` is given). GM only; FAILED when it's full. */
      addEntry: guard(async (ref, o = {}) => {
        if (!gm()) return no('NOT_GM', 'Only the GM writes onto shards.');
        if (needs('dataShardService')) return needs('dataShardService');
        const r = shardItem(ref); if (r.err) return r.err;
        if (!str(o.subject) && !str(o.file?.filename)) return no('BAD_INPUT', 'An entry needs a subject (or a file name).');
        const file = o.file && str(o.file.filename) ? { filename: short(o.file.filename, 80), path: short(o.file.path, 120), owner: short(o.file.owner ?? o.from, 60), modified: short(o.file.modified ?? service('timeService')?.getCurrentTime?.(), 40), size: Number(o.file.size) || null } : null;
        const res = await service('dataShardService').addMessage(r.item, { from: short(o.from, 80), subject: short(o.subject || file?.filename, 120), body: String(o.body ?? ''),
          ...(str(o.contentType) ? { contentType: str(o.contentType) } : {}), ...(o.contentData && typeof o.contentData === 'object' ? { contentData: o.contentData } : {}), ...(file ? { envelope: 'file', file } : {}) });
        if (res?.full) return no('FAILED', 'The shard is full.');
        return fromService(res, (x) => ({ messageId: x.messageId ?? null }));
      }),
    },

    // ───────────────────────── items ─────────────────────────
    items: {
      /** An item's key-item tag (what a shard, terminal account or network with a key-item lock compares). */
      keyTag: guard(async (ref) => {
        const item = findItem(ref);
        if (!item) return no('NOT_FOUND', 'No such item.');
        return ok({ keyTag: item.getFlag?.(MODULE_ID, 'keyTag') ?? null });
      }),
      /** Make an item a key item with that tag, or not one (null). GM only. The tag is compared exactly ("arasaka:staff"). */
      setKeyTag: guard(async (ref, tag) => {
        if (!gm()) return no('NOT_GM', 'Only the GM makes key items.');
        const item = findItem(ref);
        if (!item) return no('NOT_FOUND', 'No such item.');
        const t = tag == null ? null : str(tag);
        if (tag != null && !t) return no('BAD_INPUT', 'A tag is a non-empty string, or null to clear it.');
        if (t) await item.setFlag(MODULE_ID, 'keyTag', t.slice(0, 80)); else await item.unsetFlag?.(MODULE_ID, 'keyTag');
        return ok({ keyTag: t ? t.slice(0, 80) : null });
      }),
    },

    // ───────────────────────── terminals ─────────────────────────
    terminals: {
      /**
       * Make a world item a terminal (GM): { name, img?, config?, accounts?: [account] } — config and accounts take
       * the same fields the GM's terminal editor does (mailboxStyle 'tty' gives the command prompt).
       */
      create: guard(async (o = {}) => {
        if (!gm()) return no('NOT_GM', 'Only the GM makes terminals.');
        if (needs('terminalService')) return needs('terminalService');
        if (!str(o.name)) return no('BAD_INPUT', 'A terminal needs a name.');
        const types = [...(itemTypes() || [])];
        const type = types.includes('gear') ? 'gear' : types[0] || 'gear';
        /* createDocuments, not create: the CPR system's Item class overrides create() without returning the item */
        const Doc = globalThis.CONFIG?.Item?.documentClass;
        if (!Doc?.createDocuments) return no('UNAVAILABLE', 'Foundry\x27s Item class is not ready.');
        const [item] = await Doc.createDocuments([{ name: short(o.name, 80), type, ...(str(o.img) ? { img: str(o.img) } : {}) }]);
        if (!item) return no('FAILED', 'The item was not made.');
        const conv = await service('terminalService').convertToTerminal(item, o.config && typeof o.config === 'object' ? o.config : {});
        if (!conv?.success) { await item.delete?.(); return no('FAILED', conv?.error || 'It could not be made a terminal.'); }
        const accountIds = [];
        for (const a of (Array.isArray(o.accounts) ? o.accounts : []).slice(0, 20)) { const res = await service('terminalService').addAccount(item, { ...a }); if (res?.success) accountIds.push(res.accountId); }
        return ok({ itemId: item.id, uuid: item.uuid, accountIds });
      }),
      /** Put a file on a terminal (GM): { accountId? (else the shared drive), path?, filename, body, subject?, from?, contentType?, contentData? }. */
      addFile: guard(async (ref, o = {}) => {
        if (!gm()) return no('NOT_GM', 'Only the GM writes files onto terminals.');
        if (needs('terminalService')) return needs('terminalService');
        const r = terminalItem(ref); if (r.err) return r.err;
        if (!str(o.filename)) return no('BAD_INPUT', 'A file needs a filename.');
        const scope = str(o.accountId) || SHARED_SCOPE; const path = short(o.path, 120).replace(/^\/+|\/+$/g, '');
        if (path) { const f = await service('terminalService').saveFileFolder(r.item, { scope, path }); if (!f?.success) return no('FAILED', f?.error || 'The folder was not made.'); }
        const res = await service('terminalService').addAccountMessage(r.item, scope, { from: short(o.from, 80), subject: short(o.subject || o.filename, 120), body: String(o.body ?? ''),
          ...(str(o.contentType) ? { contentType: str(o.contentType) } : {}), ...(o.contentData && typeof o.contentData === 'object' ? { contentData: o.contentData } : {}),
          envelope: 'file', file: { filename: short(o.filename, 80), path, owner: short(o.from, 60), modified: service('timeService')?.getCurrentTime?.() ?? '', size: String(o.body ?? '').length } });
        return fromService(res, (x) => ({ messageId: x.messageId ?? null }));
      }),
      /**
       * Add a command to the TTY prompt on THIS client (register it on every client at ready). def: { name, help?,
       * applies?(ctx), run(ctx) } — run gets { itemId, itemUuid, terminalName, accountId, username, args, raw, userId,
       * actorId } and returns the line(s) to show. NCM's own commands can't be replaced.
       */
      registerCommand: guard(async (def = {}) => {
        const off = registerTerminalCommand(def);
        return off ? ok({ name: String(def.name).toLowerCase() }) : no('BAD_INPUT', 'A command needs a free name (a-z, 0-9, - or _) and a run function.');
      }),
      /** Take a registered command back off this client. */
      unregisterCommand: guard(async (name) => {
        const n = String(name || '').toLowerCase();
        return TERMINAL_COMMANDS.delete(n) ? ok({ name: n }) : no('NOT_FOUND', 'No such registered command.');
      }),
      /** The commands registered on this client: [{ name, help }]. */
      commands: guard(async () => ok([...TERMINAL_COMMANDS.values()].map((c) => ({ name: c.name, help: c.help })))),
    },

    // ───────────────────────── hud ─────────────────────────
    hud: {
      /**
       * Show (or update, by id) a timer in NCM's trace HUD, on every client it's for (GM). o: { id?, title, text?,
       * seconds? (counts down on NCM's clock) | count? (a fixed line, e.g. "3 rounds"), tone? red|amber|cyan|green,
       * icon? (fa-…), everyone? (default true), actorIds? (else only their owners), gmOnly? (only GMs see it) }. It never traces anyone.
       */
      countdown: guard(async (o = {}) => {
        if (!gm()) return no('NOT_GM', 'Only the GM shows HUD timers.');
        if (!str(o.title)) return no('BAD_INPUT', 'A timer needs a title.');
        const secs = Number(o.seconds);
        if (!(secs > 0) && o.count == null) return no('BAD_INPUT', 'Give seconds (a countdown) or count (a fixed line).');
        const id = short(str(o.id) || `tm-${globalThis.foundry?.utils?.randomID?.(8) ?? Date.now().toString(36)}`, 40);
        const row = { id, title: short(o.title, 40), text: short(o.text, 80), count: o.count == null ? null : short(o.count, 24), expiresAt: secs > 0 ? nowMs() + secs * 1000 : null,
          tone: ['red', 'amber', 'cyan', 'green'].includes(o.tone) ? o.tone : 'amber', icon: /^fa-[a-z0-9-]+$/.test(o.icon || '') ? o.icon : null,
          everyone: o.everyone !== false, gmOnly: !!o.gmOnly, actorIds: (Array.isArray(o.actorIds) ? o.actorIds : []).map(String).slice(0, 12) };
        const now = nowMs(); const cur = (getSetting('hudTimers', []) || []).filter((t) => t.id !== id && (t.expiresAt == null || t.expiresAt > now));
        await globalThis.game.settings.set(MODULE_ID, 'hudTimers', [...cur, row]);
        return ok(timerSummary(row));
      }),
      /** Take a timer off the HUD (GM). */
      clear: guard(async (id) => {
        if (!gm()) return no('NOT_GM', 'Only the GM clears HUD timers.');
        const cur = getSetting('hudTimers', []) || [];
        if (!cur.some((t) => t.id === str(id))) return no('NOT_FOUND', 'No such timer.');
        await globalThis.game.settings.set(MODULE_ID, 'hudTimers', cur.filter((t) => t.id !== str(id)));
        return ok({ id: str(id) });
      }),
      /** The timers showing now (anyone). */
      timers: guard(async () => { const now = nowMs(); return ok((getSetting('hudTimers', []) || []).filter((t) => t.expiresAt == null || t.expiresAt > now).map(timerSummary)); }),
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
